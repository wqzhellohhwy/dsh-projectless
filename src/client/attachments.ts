import type { Context } from '@deepseek-ai/cordis'

/**
 * Keep pasted-image drafts alive across Session switches.
 *
 * Text drafts survive because DSH mirrors them into `localStorage`. Attachments
 * do not: an image lives only in memory, as a `Map` entry plus a blob URL, and
 * `releaseDraftAttachment(id)` (lib/client.js:3637) does two irreversible
 * things —
 *
 *   this.draftAttachments.delete(id);        // the bytes are gone
 *   revokePreview(attachment.previewUrl);    // and the URL is dead for good
 *
 * — so once it runs, nothing can bring the thumbnail back even if the Session's
 * own `attachmentIds` still lists it. Switching Sessions deletes the shell's
 * children, and DSH's teardown calls this for every draft the shell held.
 *
 * The fix is to make the release *deferred* rather than destructive. For the
 * most recent `RETAINED_LIMIT` releases this wrapper simply does not call the
 * original: DSH's own `Map` entry stays exactly where the render path reads it,
 * so `resolveDraftAttachments` keeps finding the thumbnail and the blob URL is
 * never revoked. A side table only records *release order*, so that beyond the
 * limit the oldest ids are handed to the original for real — that keeps memory
 * bounded instead of leaking an unbounded pile of blobs.
 *
 * What this does **not** do: persist across a page reload. Blob URLs cannot be
 * survived by anything short of storing the bytes (IndexedDB) and re-uploading
 * them, which is a different and much larger change. Scope here is exactly what
 * was asked for — switching Sessions or workspaces keeps the image.
 */

/** How many released attachments stay resolvable before the oldest is dropped. */
const RETAINED_LIMIT = 64

interface AttachmentLike {
  id: string
  kind?: string
  previewUrl?: string
  [key: string]: unknown
}

interface ConversationFace {
  draftAttachments?: Map<string, AttachmentLike>
  releaseDraftAttachment?: (id: string) => void
}

export interface AttachmentRetentionStats {
  /** Whether the conversation service was reachable and the wrapper installed. */
  installed: boolean
  /** Attachments currently held alive by this wrapper. */
  retained: number
  /** Live draft attachments DSH still owns (never released). */
  live: number
  /** Releases that were deferred instead of destroying the attachment. */
  deferred: number
  lastError: string | null
}

/**
 * Install the deferred-release wrapper.
 *
 * Idempotent per page: a second call on an already-wrapped service is a no-op,
 * which matters because the client face can be re-applied by a bundle reload.
 */
export function keepDraftAttachments(ctx: Context, pluginName: string): AttachmentRetentionStats {
  const stats: AttachmentRetentionStats = { installed: false, retained: 0, live: 0, deferred: 0, lastError: null }
  let conversation: ConversationFace | undefined
  try {
    conversation = ctx.get('conversation' as never) as unknown as ConversationFace | undefined
  } catch (reason) {
    stats.lastError = `get(conversation): ${String(reason).slice(0, 100)}`
    return stats
  }
  if (conversation === undefined || typeof conversation.releaseDraftAttachment !== 'function') {
    stats.lastError = 'conversation service has no releaseDraftAttachment'
    return stats
  }
  const holder = conversation as ConversationFace & { __projectlessRetains?: Map<string, AttachmentLike> }
  if (holder.__projectlessRetains !== undefined) {
    stats.installed = true
    stats.lastError = 'already installed'
    return stats
  }

  const retained = new Map<string, AttachmentLike>()
  holder.__projectlessRetains = retained
  const original = conversation.releaseDraftAttachment.bind(conversation)

  const evict = (): void => {
    while (retained.size > RETAINED_LIMIT) {
      const oldest = retained.keys().next()
      if (oldest.done === true) break
      const id = oldest.value
      retained.delete(id)
      try {
        original(id)
      } catch { /* the original is best-effort */ }
    }
  }

  // Only the singular method is wrapped: the plural one fans out to
  // `this.releaseDraftAttachment`, so it reaches this wrapper on its own.
  conversation.releaseDraftAttachment = (id: string): void => {
    const live = conversation?.draftAttachments
    if (live?.get(id) === undefined) {
      // Nothing here to protect — either released before or never known. Let the
      // original run so genuinely unknown ids behave exactly as DSH expects.
      try { original(id) } catch { /* best effort */ }
      return
    }
    // Deliberately NOT calling the original: that is what keeps the entry in the
    // Map the render path reads and keeps the blob URL unrevoked. Note the
    // order — eviction hands the *oldest* ids to the original for real.
    retained.set(id, { id })
    stats.deferred += 1
    evict()
  }

  ctx.effect(() => () => {
    retained.clear()
    delete holder.__projectlessRetains
  }, `${pluginName}: retained draft attachments`)

  stats.installed = true
  return stats
}

/** Snapshot the counters for the diagnostics line. */
export function attachmentStats(ctx: Context, stats: AttachmentRetentionStats): void {
  try {
    const conversation = ctx.get('conversation' as never) as unknown as ConversationFace | undefined
    stats.live = conversation?.draftAttachments?.size ?? 0
    const holder = conversation as (ConversationFace & { __projectlessRetains?: Map<string, AttachmentLike> }) | undefined
    stats.retained = holder?.__projectlessRetains?.size ?? 0
  } catch {
    // Diagnostics must never throw.
  }
}
