// 共享库：定位 DeepSeek Harness 的 app.asar，并提供等长字节替换的读写原语。
//
// 这里刻意不写入任何本机路径：asar 位置要么由调用方给出（--asar / DSH_ASAR），
// 要么从各平台的常规安装位置探测。找不到就报错退出，绝不去猜、也不会去创建文件。
import fs from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** asar 相对归档根的路径（打包时在 Windows 上完成，分隔符是反斜杠）。 */
export const CONVERSATION_CLIENT = 'dsh\\node_modules\\@deepseek-ai\\dsh-client-ui-conversation\\lib\\client.js'

/** 各平台常见的安装位置。顺序即优先级。 */
export function asarCandidates() {
  const list = []
  const app = 'DeepSeek Harness'
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA
    const programFiles = process.env.ProgramFiles
    const programFilesX86 = process.env['ProgramFiles(x86)']
    if (local) list.push(join(local, 'Programs', app, 'resources', 'app.asar'))
    if (programFiles) list.push(join(programFiles, app, 'resources', 'app.asar'))
    if (programFilesX86) list.push(join(programFilesX86, app, 'resources', 'app.asar'))
  } else if (process.platform === 'darwin') {
    list.push(`/Applications/${app}.app/Contents/Resources/app.asar`)
    list.push(join(homedir(), 'Applications', `${app}.app`, 'Contents', 'Resources', 'app.asar'))
  } else {
    list.push(`/opt/${app}/resources/app.asar`)
    list.push(join(homedir(), '.local', 'share', app, 'resources', 'app.asar'))
    list.push(`/usr/lib/${app}/resources/app.asar`)
  }
  return list
}

/** 解析命令行与环境变量里给出的 asar 路径。 */
export function asarFromArgs(argv) {
  const at = argv.indexOf('--asar')
  if (at !== -1 && argv[at + 1]) return argv[at + 1]
  if (process.env.DSH_ASAR) return process.env.DSH_ASAR
  return undefined
}

/**
 * 找到 asar：显式指定优先，其次探测。
 * @returns 绝对路径，或 undefined（找不到时由调用方决定怎么报错）。
 */
export function detectAsar(argv = process.argv) {
  const explicit = asarFromArgs(argv)
  if (explicit !== undefined) return fs.existsSync(explicit) ? explicit : undefined
  return asarCandidates().find(candidate => fs.existsSync(candidate))
}

/** asar 头部：[4][headerPickleSize][4=长度前缀][jsonSize][JSON…]，数据区从 16+jsonSize 对齐后开始。 */
export function openArchive(file, writable = false) {
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

/** 把归档头展开成 { path, size, offset } 列表；path 用归档自己的反斜杠形式。 */
export function listFiles(header) {
  const out = []
  const walk = (node, prefix) => {
    for (const [name, value] of Object.entries(node)) {
      if (value && typeof value === 'object' && value.files) walk(value.files, `${prefix}\\${name}`)
      else out.push({ path: `${prefix}\\${name}`, size: value.size, offset: Number(value.offset) })
    }
  }
  walk(header.files ?? header, '')
  return out
}

/** 读归档内一个文件的完整内容。 */
export function readEntry(fd, baseOffset, entry) {
  const buffer = Buffer.alloc(entry.size)
  fs.readSync(fd, buffer, 0, entry.size, baseOffset + entry.offset)
  return buffer
}

/** 在归档内按路径后缀找文件（后缀用反斜杠形式）。 */
export function findEntry(files, pathSuffix) {
  return files.find(file => file.path.endsWith(pathSuffix))
}

/**
 * 等长字节替换一个文件的片段。
 * @returns 'patched' | 'already' | 'missing' | 'mismatch'
 */
export function spliceBytes(fd, baseOffset, entry, offsetInFile, oldBytes, newBytes) {
  if (oldBytes.length !== newBytes.length) throw new Error('等长替换要求字节长度一致')
  const buffer = Buffer.alloc(oldBytes.length)
  fs.readSync(fd, buffer, 0, oldBytes.length, baseOffset + entry.offset + offsetInFile)
  if (buffer.equals(newBytes)) return 'already'
  if (!buffer.equals(oldBytes)) return 'mismatch'
  fs.writeSync(fd, newBytes, 0, newBytes.length, baseOffset + entry.offset + offsetInFile)
  return 'patched'
}

/** 读归档内任意偏移处的一段字节。 */
export function readAt(fd, baseOffset, absoluteOffsetInDataArea, length) {
  const buffer = Buffer.alloc(length)
  fs.readSync(fd, buffer, 0, length, baseOffset + absoluteOffsetInDataArea)
  return buffer
}
