// DSH app.asar 的读取与「等长原地替换」工具。
//
// 用途：给 DeepSeek Harness 本体打 DSH-COMPOSER-GATE 补丁（见同目录 README.md）。
// 设计原则：只替换**长度完全相同**的字符串，因此不需要重新打包 asar，
// 也不会改变文件内任何偏移；工具会先做逐字节比对，不一致就拒绝写入。
//
// 用法：
//   node asar-patch.mjs probe   <asar>                                   头部结构自检
//   node asar-patch.mjs list    <asar> <路径子串>                         列出匹配文件
//   node asar-patch.mjs find    <asar> <路径子串> <搜索串>                 定位命中（含文件内偏移）
//   node asar-patch.mjs peek    <asar> <文件内偏移> [长度]                 查看该处真实内容
//   node asar-patch.mjs backup  <asar>                                   备份为 <asar>.bak-projectless
//   node asar-patch.mjs splice  <asar> <文件内偏移> <原文> <等长新文>       原地替换
//   node asar-patch.mjs restore <asar>                                   从备份还原
import fs from 'node:fs'

const [, , command, archive, ...rest] = process.argv

function openArchive(file, writable = false) {
  const fd = fs.openSync(file, writable ? 'r+' : 'r')
  const head = Buffer.alloc(16)
  fs.readSync(fd, head, 0, 16, 0)
  // 头部布局：[4][headerPickleSize][4=长度前缀][jsonSize][JSON...]
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

const WRITES = command === 'splice'
const { fd, header, baseOffset } = openArchive(archive, WRITES)
const files = walk(header.files ?? header, '', [])

function resolveTargets(filter) {
  return files.filter(f => f.path.includes(filter ?? '') && !f.path.endsWith('.map'))
}

if (command === 'probe') {
  console.log(JSON.stringify({ baseOffset, files: files.length }, null, 1))
} else if (command === 'list') {
  for (const file of resolveTargets(rest[0])) console.log(`${file.path}\t${file.size}\t${file.offset}`)
} else if (command === 'peek') {
  // 偏移是「文件数据区」内的偏移；不带路径时对所有文件搜索该偏移意义不大，
  // 因此这里接受的是数据区绝对偏移（find 输出的「文件内偏移」需加上该文件的 offset）。
  const at = Number(rest[0])
  const length = Number(rest[1] ?? 300)
  const buffer = Buffer.alloc(length)
  fs.readSync(fd, buffer, 0, length, baseOffset + at)
  console.log(JSON.stringify(buffer.toString('utf8')))
} else if (command === 'find') {
  const [pathFilter, needle] = rest
  const targets = resolveTargets(pathFilter)
  if (needle === undefined) {
    console.log(`匹配文件 ${targets.length} 个`)
    for (const target of targets.slice(0, 10)) console.log(`  ${target.path} ${target.size}`)
    process.exit(0)
  }
  let hits = 0
  for (const target of targets) {
    const buffer = Buffer.alloc(target.size)
    fs.readSync(fd, buffer, 0, target.size, baseOffset + target.offset)
    const text = buffer.toString('latin1')
    let from = 0
    while (true) {
      const at = text.indexOf(needle, from)
      if (at === -1) break
      hits += 1
      // peek 需要的偏移 = 文件数据区偏移(target.offset) + 文件内偏移(at)
      console.log(`${target.path}  文件内 ${at}  数据区 ${target.offset + at}`)
      console.log(`   …${text.slice(Math.max(0, at - 40), at + needle.length + 20)}…`)
      from = at + 1
    }
  }
  if (hits === 0) console.log('未命中')
} else if (command === 'splice') {
  const [atArg, oldText, newText] = rest
  const at = Number(atArg)
  if (newText.length !== oldText.length) {
    console.log(`长度不等（${oldText.length} vs ${newText.length}）—— 拒绝写入`)
    process.exit(1)
  }
  const buffer = Buffer.alloc(oldText.length)
  fs.readSync(fd, buffer, 0, oldText.length, baseOffset + at)
  const found = buffer.toString('latin1')
  if (found !== oldText) {
    console.log(`该位置实际为 ${JSON.stringify(found)}，与预期不符 —— 拒绝写入`)
    process.exit(1)
  }
  fs.writeSync(fd, Buffer.from(newText, 'latin1'), 0, newText.length, baseOffset + at)
  console.log(`已在数据区偏移 ${at} 把 ${JSON.stringify(oldText)} 改为 ${JSON.stringify(newText)}`)
} else if (command === 'backup') {
  const backup = `${archive}.bak-projectless`
  if (fs.existsSync(backup)) console.log(`备份已存在，未覆盖：${backup}`)
  else {
    fs.copyFileSync(archive, backup)
    console.log(`已备份：${backup}`)
  }
} else if (command === 'restore') {
  const backup = `${archive}.bak-projectless`
  if (!fs.existsSync(backup)) {
    console.log(`没有备份：${backup}`)
    process.exit(1)
  }
  fs.closeSync(fd)
  fs.copyFileSync(backup, archive)
  console.log(`已从备份还原：${archive}`)
  process.exit(0)
}
fs.closeSync(fd)
