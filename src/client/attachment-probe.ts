import type { Context } from '@deepseek-ai/cordis'
import { report } from './diagnostics.ts'

/**
 * End-to-end probe for pasted-image survival.
 *
 * The unit test proved the wrapper intercepts `releaseDraftAttachment`, and the
 * live counters prove the bytes stay in DSH's own Map (`live` stays above zero
 * while `deferred` climbs). Yet the picture still disappears on screen when the
 * user switches away and back. So the loss is not in the attachment store —
 * something else between "switch away" and "come back" drops it.
 *
 * This walks the real path and samples after every step, so the failing step
 * names itself:
 *
 *   paste  →  measure  →  switch away  →  measure  →  switch back  →  measure
 *
 * Two independent signals are recorded at each stop:
 *   - `thumbs`  : number of `img[src^="blob:"]` in the DOM — literally what the
 *                 user sees;
 *   - `live`    : size of DSH's draft-attachment Map — whether the bytes exist.
 *
 * If `live` holds but `thumbs` goes to zero, the store is fine and the render
 * input (the shell's `attachmentIds`) is what got dropped.
 */

/** Smallest valid PNG (1×1, transparent); enough for DSH to classify as an image. */
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

interface ProbeDeps {
  /** The Session the main view currently retains. */
  currentSessionId(): string | undefined
  /** Any other Session id to switch to (a real one that already has messages). */
  otherSessionId(exclude: string | undefined): string | undefined
  /** Navigate the main view to a Session. */
  openSession(sessionId: string): void
  /** Size of DSH's draft-attachment Map. */
  liveAttachments(): number
  /**
   * What one Session's input shell holds right now: the draft text and the id
   * list the render path iterates. `live` counts bytes; this counts what the
   * composer is *told* to draw — the two can disagree, and when they do, the
   * thumbnail vanishes while the bytes sit there unused.
   */
  shellState(sessionId: string | undefined): { ids: number, draft: number, sameShell: boolean } | undefined
  /**
   * The attachment ids a Session's shell is currently asked to draw. Used to
   * drive the deletion step the way the UI does.
   */
  shellAttachmentIds(sessionId: string | undefined): readonly string[]
  /**
   * Remove one attachment through DSH's own path. The × on a thumbnail runs
   * **two** statements (lib/client.js:18401):
   *
   *   if (shell.removeAttachment(id)) conversation.releaseDraftAttachment(id)
   *
   * so this does both — calling only the first would leave the bytes in place
   * and the probe would report a leak that the real UI does not have.
   */
  removeAttachment(sessionId: string | undefined, attachmentId: string): boolean
}

/** Count blob-backed images on screen — what the user actually sees. */
function thumbs(): number {
  try {
    return document.querySelectorAll('img[src^="blob:"]').length
  } catch {
    return -1
  }
}

/** Count attachment chips/previews in the composer area, independent of tag. */
function composerAttachmentChips(): number {
  try {
    const editable = document.querySelector('[contenteditable="true"]')
    const scope = editable?.closest('form') ?? editable?.parentElement?.parentElement?.parentElement
    if (scope === null || scope === undefined) return -1
    return scope.querySelectorAll('img[src^="blob:"], [data-attachment-id]').length
  } catch {
    return -1
  }
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => { window.setTimeout(resolve, ms) })

/**
 * Synthesize a real paste of one PNG into whatever composer is on screen.
 *
 * DSH listens for the ordinary `paste` clipboard event, so a `ClipboardEvent`
 * carrying a `DataTransfer` with a `File` in it is indistinguishable from a user
 * pressing Ctrl+V — which is the point: this exercises the production path
 * rather than poking at internals.
 */
async function pasteImage(): Promise<string> {
  const editable = document.querySelector('[contenteditable="true"]')
  if (editable === null) return 'no composer on screen'
  let file: File
  try {
    const binary = atob(PNG_BASE64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
    file = new File([bytes], 'projectless-probe.png', { type: 'image/png' })
  } catch (reason) {
    return `cannot build file: ${String(reason).slice(0, 80)}`
  }
  try {
    const transfer = new DataTransfer()
    transfer.items.add(file)
    const event = new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true })
    editable.dispatchEvent(event)
    return 'dispatched'
  } catch (reason) {
    return `dispatch failed: ${String(reason).slice(0, 80)}`
  }
}

/** Run the round trip and report each stop. */
export async function runAttachmentRoundTrip(ctx: Context, deps: ProbeDeps): Promise<void> {
  const start = deps.currentSessionId()
  const other = deps.otherSessionId(start)
  const timeline: Record<string, unknown>[] = []
  const sample = (label: string): void => {
    const current = deps.currentSessionId()
    const shell = deps.shellState(current)
    timeline.push({
      step: label,
      session: (current ?? '').slice(0, 18),
      thumbs: thumbs(),
      chips: composerAttachmentChips(),
      live: deps.liveAttachments(),
      shellIds: shell?.ids ?? null,
      shellDraft: shell?.draft ?? null,
    })
  }

  sample('before-paste')
  const pasted = await pasteImage()
  await wait(2000)
  sample('after-paste')

  if (other !== undefined) {
    deps.openSession(other)
    await wait(2000)
    sample('after-switch-away')
    deps.openSession(start ?? other)
    await wait(2500)
    sample('after-switch-back')
    const kept = thumbs()

    // Second half: the user deletes the image with the × on the thumbnail, then
    // navigates away and back. It must NOT come back — a blanket "keep every
    // release" wrapper resurrects it, which is the bug being fixed here.
    const ids = deps.shellAttachmentIds(start)
    const removed = ids.length > 0
      ? deps.removeAttachment(start, ids[0] as string)
      : false
    await wait(1500)
    sample('after-remove')
    deps.openSession(other)
    await wait(2000)
    deps.openSession(start ?? other)
    await wait(2500)
    sample('after-remove-switch-back')
    const revived = thumbs()

    report(ctx, {
      phase: 'attachment-roundtrip',
      pasted,
      startSession: (start ?? '').slice(0, 18),
      otherSession: (other ?? '').slice(0, 18),
      keptAfterSwitch: kept,
      removalAttempted: ids.length,
      removed,
      thumbsAfterRemoveReturn: revived,
      verdict: (kept >= 1 ? '切换后保留 ✓' : '切换后丢失 ✗')
        + ' / ' + (revived === 0 ? '删除后不再复活 ✓' : `删除后又复活 ✗ (thumbs=${revived})`),
      timeline,
    })
    return
  }

  report(ctx, {
    phase: 'attachment-roundtrip',
    pasted,
    startSession: (start ?? '').slice(0, 18),
    otherSession: null,
    timeline,
  })
}
