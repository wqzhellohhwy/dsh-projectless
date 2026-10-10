// 一键给 DeepSeek Harness 打上本插件需要的两处补丁（也可以只检查）。
//
//   node install-patches.mjs              探测安装位置并打补丁
//   node install-patches.mjs --check      只检查，不写任何字节
//   node install-patches.mjs --asar <path>  显式指定 app.asar
//   node install-patches.mjs --restore    从备份整体还原
//
// 两处补丁都是**等长字节替换**：不改变文件长度、不重打包、可整体回滚。
// 任何一步对不上（定位串找不到、出现多次、字节不符）都会停止，若已写过则自动回滚。
import fs from 'node:fs'
import {
  CONVERSATION_CLIENT,
  asarCandidates,
  detectAsar,
  findEntry,
  listFiles,
  openArchive,
  readEntry,
  spliceBytes,
} from './dsh-asar.mjs'

/**
 * 补丁清单。
 *
 * 每个补丁 = **锚点**（`anchor`，只出现一次，且**位于被替换文本之前**）
 *            + 紧跟其后的 `old` → 等长替换成 `new`。
 *
 * 锚点刻意**不包含** `old`：否则补丁一旦打上，锚点自己也消失了，检查模式就会
 * 误报「定位串未找到」。两个锚点都选在替换点之前、且补丁前后都不变的文本上，
 * 因此同一套逻辑既能判断「未打」，也能判断「已打」。
 */
export const PATCHES = [
  {
    id: 'composer-gate',
    title: '解开 DSH 对「无工作区空白会话」输入框的禁用',
    anchor: 'sessionWorkspace?.title ?? (workspaces.phase === ',
    old: '"ready"',
    new: '"readx"',
  },
  {
    id: 'composer-chip',
    title: 'hero 的工作区标签固定显示「未分组」',
    // cwd 兜底分支的固定前缀；补丁 1 只改更靠后的 "ready"，不影响这里
    anchor: '|| cwd === void 0 || cwd === "" ? void 0 : ',
    old: 'workspaceLabel(cwd)',
    new: '"未分组        "',
  },
]

const CHECK_ONLY = process.argv.includes('--check')
const RESTORE = process.argv.includes('--restore')

const archive = detectAsar()
if (archive === undefined) {
  console.error('找不到 app.asar。')
  console.error('请用 --asar <路径> 指定，或设置环境变量 DSH_ASAR。')
  console.error('常见位置：')
  for (const candidate of asarCandidates()) console.error(`  ${candidate}`)
  process.exit(1)
}
const backup = `${archive}.bak-projectless`

if (RESTORE) {
  if (!fs.existsSync(backup)) {
    console.error(`没有备份：${backup}`)
    process.exit(1)
  }
  fs.copyFileSync(backup, archive)
  console.log(`已从备份还原：${archive}`)
  process.exit(0)
}

console.log(`DSH app.asar: ${archive}`)
console.log(CHECK_ONLY ? '模式：只检查\n' : '模式：打补丁\n')

// 备份要在打开之前做，否则写完再复制就把补丁也备份进去了
if (!CHECK_ONLY && !fs.existsSync(backup)) {
  fs.copyFileSync(archive, backup)
  console.log(`已备份原文件：${backup}`)
}

const { fd, header, baseOffset } = openArchive(archive, !CHECK_ONLY)
const files = listFiles(header)
const entry = findEntry(files, CONVERSATION_CLIENT)
if (entry === undefined) {
  console.error(`归档里没有找到 ${CONVERSATION_CLIENT}`)
  console.error('这个 DSH 可能不是 Desktop 版，或者目录结构已经变化。')
  fs.closeSync(fd)
  process.exit(1)
}

/** 一处补丁的判定结果：锚点唯一，被替换的字节紧跟在锚点之后。 */
function inspect(patch, contents) {
  const text = contents.toString('latin1')
  const anchorAt = text.indexOf(patch.anchor)
  if (anchorAt === -1) return { state: 'missing' }
  if (text.indexOf(patch.anchor, anchorAt + 1) !== -1) return { state: 'ambiguous' }
  const offsetInFile = anchorAt + patch.anchor.length
  const oldBytes = Buffer.from(patch.old, 'latin1')
  const newBytes = Buffer.from(patch.new, 'utf8')
  if (oldBytes.length !== newBytes.length) return { state: 'length-mismatch' }
  const current = contents.subarray(offsetInFile, offsetInFile + oldBytes.length)
  if (current.equals(newBytes)) return { state: 'already', offsetInFile }
  if (current.equals(oldBytes)) return { state: 'pending', offsetInFile }
  return { state: 'mismatch', offsetInFile, found: current.toString('utf8') }
}

const results = []
let contents = readEntry(fd, baseOffset, entry)
const states = PATCHES.map((patch) => {
  const state = inspect(patch, contents)
  results.push({ patch, state })
  return state
})

if (CHECK_ONLY) {
  for (const { patch, state } of results) {
    const label = {
      already: '已打',
      pending: '未打',
      missing: '锚点未找到（DSH 版本可能已变）',
      ambiguous: '锚点出现多次，拒绝处理',
      mismatch: `该处内容与预期不符${state.found === undefined ? '' : `（实际为 ${JSON.stringify(state.found)}）`}`,
      'length-mismatch': '脚本内部错误：替换字节长度不一致',
    }[state.state] ?? state.state
    console.log(`[${state.state === 'already' ? '✓' : '·'}] ${patch.id}: ${label}`)
    console.log(`     ${patch.title}`)
  }
  const done = states.every(state => state.state === 'already')
  console.log(`\n结论：${done ? '两处补丁都已生效。' : '还有补丁未打 —— 运行 node install-patches.mjs 应用。'}`)
  fs.closeSync(fd)
  process.exit(done ? 0 : 2)
}

if (states.every(state => state.state === 'already')) {
  console.log('两处补丁都已经打过了，无需重复写入。')
  fs.closeSync(fd)
  process.exit(0)
}

const blocked = results.find(({ state }) => state.state !== 'already' && state.state !== 'pending')
if (blocked !== undefined) {
  console.error(`补丁 ${blocked.patch.id} 无法安全定位（${blocked.state.state}），未写入任何字节。`)
  console.error('请把上面的状态贴给插件作者，或改用 --check 确认当前状态。')
  fs.closeSync(fd)
  process.exit(1)
}

let wrote = 0
try {
  for (const { patch, state } of results) {
    if (state.state !== 'pending') {
      console.log(`[跳过] ${patch.id}（已打）`)
      continue
    }
    const outcome = spliceBytes(
      fd,
      baseOffset,
      entry,
      state.offsetInFile,
      Buffer.from(patch.old, 'latin1'),
      Buffer.from(patch.new, 'utf8'),
    )
    if (outcome !== 'patched') throw new Error(`${patch.id}: ${outcome}`)
    wrote += 1
    console.log(`[已打] ${patch.id} —— ${patch.title}`)
  }

  // 逐个重新检查，确认字节真的落盘了（用与写入前同一套判定）
  const after = readEntry(fd, baseOffset, entry)
  for (const { patch } of results) {
    const state = inspect(patch, after)
    if (state.state !== 'already') throw new Error(`${patch.id}: 回读校验失败（${state.state}）`)
  }
  console.log(`\n完成：写入 ${wrote} 处，回读校验通过。`)
  console.log('请完全退出 DSH 再重新打开（仅刷新页面不够，补丁在启动时载入）。')
} catch (reason) {
  console.error(`\n失败：${reason instanceof Error ? reason.message : String(reason)}`)
  fs.closeSync(fd)
  fs.copyFileSync(backup, archive)
  console.error(`已从备份整体还原：${archive}`)
  process.exit(1)
}

fs.closeSync(fd)
