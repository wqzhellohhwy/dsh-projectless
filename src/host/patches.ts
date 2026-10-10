import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * Read the archive through the *unpatched* file system.
 *
 * Electron replaces `fs` with an asar-aware layer in which `app.asar` behaves
 * like a directory: `existsSync` says yes, while `readFileSync` on the archive
 * itself fails with ENOENT because it is looking for a member inside it.
 * `original-fs` is Electron's escape hatch back to the real file system; under
 * plain Node it does not exist, so the ordinary `fs` is used there.
 */
async function readArchive(path: string): Promise<string> {
  try {
    const original = await import('original-fs' as string)
    const fs = (original as { default?: typeof import('node:fs') }).default ?? original as typeof import('node:fs')
    return fs.readFileSync(path, 'latin1')
  } catch {
    return readFileSync(path, 'latin1')
  }
}



/**
 * Self-check for the two DSH-side patches this plugin needs.
 *
 * The patches live in the *application's* `app.asar`, not in this plugin, so
 * the plugin cannot apply them — and should not try to. What it can do is tell
 * the truth about whether they are there, because "the composer is still inert"
 * and "the patch was never applied" look identical from the UI.
 *
 * Detection is deliberately dumb: the patched bytes are unique literals, so a
 * plain substring search over the archive is both sufficient and immune to the
 * archive layout changing between DSH builds.
 */

/** Present only after the composer-gate patch. Plain ASCII, so it needs no transcoding. */
const GATE_MARKER = 'workspaces.phase === "readx"'

/**
 * Present only after the composer-chip patch.
 *
 * The archive is read as latin1 (one character per byte) so that offsets stay
 * meaningful, which means a marker containing non-ASCII text has to be encoded
 * the same way before comparing — otherwise "未分组" is 3 characters on one side
 * and 9 bytes on the other, and the search silently never matches.
 */
const CHIP_MARKER = Buffer.from('"未分组        "', 'utf8').toString('latin1')

export interface PatchStatus {
  /** Absolute path of the inspected archive, or null when it could not be found. */
  archive: string | null
  /** Whether the archive was readable at all. */
  readable: boolean
  /** Whether the composer-gate patch is in place. */
  composerGate: boolean
  /** Whether the composer-chip patch is in place. */
  composerChip: boolean
  /** Human-readable summary for the diagnostics log. */
  summary: string
}

/**
 * Locate the running application's `app.asar`.
 *
 * `process.resourcesPath` is set by Electron in the main process. The fallbacks
 * cover being loaded by a bare Node process (for example a `dsh` CLI run from
 * the same install tree), and simply give up rather than guess wildly.
 */
function resolveArchive(): string | null {
  const resources = (process as { resourcesPath?: unknown }).resourcesPath
  const candidates: string[] = []
  if (typeof resources === 'string' && resources !== '') {
    candidates.push(join(resources, 'app.asar'))
  }
  try {
    const execDir = dirname(process.execPath)
    candidates.push(join(execDir, 'resources', 'app.asar'))
    candidates.push(join(execDir, '..', 'resources', 'app.asar'))
  } catch {
    // process.execPath is always defined in practice; ignore if it is not.
  }
  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) return candidate
    } catch {
      // keep looking
    }
  }
  return null
}

/** Inspect the archive for both patch markers. Never throws. */
export async function detectPatchStatus(): Promise<PatchStatus> {
  const archive = resolveArchive()
  if (archive === null) {
    return {
      archive: null,
      readable: false,
      composerGate: false,
      composerChip: false,
      summary: '未找到 app.asar（可能不是 Desktop 版，或安装位置不常见）',
    }
  }
  let text: string
  try {
    // latin1 keeps every byte addressable as one character, which is all a
    // substring search for the markers needs.
    text = await readArchive(archive)
  } catch (reason) {
    return {
      archive,
      readable: false,
      composerGate: false,
      composerChip: false,
      summary: `app.asar 读取失败：${reason instanceof Error ? reason.message : String(reason)}`,
    }
  }
  const composerGate = text.includes(GATE_MARKER)
  const composerChip = text.includes(CHIP_MARKER)
  const missing = [
    composerGate ? null : '输入框解锁',
    composerChip ? null : '标签文案',
  ].filter((value): value is string => value !== null)
  return {
    archive,
    readable: true,
    composerGate,
    composerChip,
    summary: missing.length === 0
      ? '两处补丁均已生效'
      : `缺少补丁：${missing.join('、')} —— 运行 tools/dsh-composer-gate/install-patches.mjs`,
  }
}
