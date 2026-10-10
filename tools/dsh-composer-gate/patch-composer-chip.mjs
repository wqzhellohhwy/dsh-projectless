// 补丁 2：让 hero 的工作区标签对「无工作区会话」显示「未分组」。
//
// 背景：`dsh-client-ui-conversation` 用 cwd 的 basename 当工作区标签，
// 所以每个会话有自己的目录时，标签就会显示 session-08-54-15-xxxx。
// DSH 自己的另一个包（dsh-client-ui-workspace）里同名函数有「未分组」分支
// （cwd 为空时返回空串，注释称之 empty ungrouped marker），conversation 这条
// 路径漏了它 —— 本补丁就是把那处调用换成一个固定的「未分组」文案。
//
// 做法与补丁 1 相同：**等长字节替换**，不动文件长度、不重打包。
// 替换的是「使用点」，不是函数定义（定义在文件内 603880 附近，必须保持原样）。
//
// 用法：
//   node patch-composer-chip.mjs [asar 路径]
//   node patch-composer-chip.mjs --revert-labels?   （不支持；还原请用 asar-patch.mjs restore）
import fs from 'node:fs'

const DEFAULT_ASAR = 'C:/Users/53518/AppData/Local/Programs/DeepSeek Harness/resources/app.asar'
const archive = process.argv[2] ?? DEFAULT_ASAR

/** 定位用：只有「cwd 兜底」那一处带这个前缀，函数定义处不带。 */
const LOCATOR = '? void 0 : workspaceLabel(cwd)))'
const LOCATOR_TO_CALL = '? void 0 : '.length
const OLD = 'workspaceLabel(cwd)'      // 19 字节
const NEW = '"未分组        "'          // 1 + 9(未分组) + 8 空格 + 1 = 19 字节

function openArchive(file, writable) {
  const fd = fs.openSync(file, writable ? 'r+' : 'r')
  const head = Buffer.alloc(16)
  fs.readSync(fd, head, 0, 16, 0)
  const jsonSize = head.readUInt32LE(12)
  const json = Buffer.alloc(jsonSize)
  fs.readSync(fd, json, 0, jsonSize, 16)
  const header = JSON.parse(json.toString('utf8'))
  const baseOffset = 16 + jsonSize + ((4 - (jsonSize % 4)) % 4)
  return { fd, header, baseOffset }
}

function walk(node, prefix, out) {
  for (const [name, value] of Object.entries(node)) {
    if (value && typeof value === 'object' && value.files) walk(value.files, `${prefix}\\${name}`, out)
    else out.push({ path: `${prefix}\\${name}`, size: value.size, offset: Number(value.offset) })
  }
  return out
}

const oldBytes = Buffer.from(OLD, 'utf8')
const newBytes = Buffer.from(NEW, 'utf8')
if (oldBytes.length !== newBytes.length) {
  console.log(`内部错误：字节长度不等（${oldBytes.length} vs ${newBytes.length}）`)
  process.exit(1)
}

const { fd, header, baseOffset } = openArchive(archive, true)
const files = walk(header.files ?? header, '', [])
const target = files.find(f => f.path.endsWith('dsh-client-ui-conversation\\lib\\client.js'))
if (target === undefined) {
  console.log('未找到 conversation 的 client.js')
  process.exit(1)
}

const buffer = Buffer.alloc(target.size)
fs.readSync(fd, buffer, 0, target.size, baseOffset + target.offset)
const text = buffer.toString('latin1')

const locatorAt = text.indexOf(LOCATOR)
if (locatorAt === -1) {
  console.log('未找到定位串 —— DSH 版本可能已变，请用 asar-patch.mjs find 重新定位')
  process.exit(1)
}
const callAt = locatorAt + LOCATOR_TO_CALL
const current = buffer.subarray(callAt, callAt + oldBytes.length)

if (current.equals(newBytes)) {
  console.log('补丁 2 已经打过了（该处已是「未分组」），无需重复写入。')
  process.exit(0)
}
if (!current.equals(oldBytes)) {
  console.log(`该处实际为 ${JSON.stringify(current.toString('utf8'))}，与预期不符 —— 拒绝写入`)
  process.exit(1)
}

fs.writeSync(fd, newBytes, 0, newBytes.length, baseOffset + target.offset + callAt)
fs.closeSync(fd)
console.log(`补丁 2 已写入：数据区偏移 ${target.offset + callAt}，「${OLD}」→「未分组」`)
console.log('重启 DSH 后，无工作区会话的 hero 标签会显示「未分组」。')
console.log('还原：node asar-patch.mjs restore "<asar 路径>"')
