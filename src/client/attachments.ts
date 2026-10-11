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
 * own `attachmentIds` still lists it.
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
  /** Whether the conversation service was reached and the wrapper installed. */
  installed: boolean
  /** Attachments currently held alive by this wrapper. */
  retained: number
  /** Live draft attachments DSH still owns (never released). */
  live: number
  /** Releases that were deferred instead of destroying the attachment. */
  deferred: number
  lastError: string | null
  /** Shape of the service, captured when the wrapper could not install. */
  probe?: string
}

/**
 * Describe whatever `ctx.get('conversation')` returned, without assuming it is
 * the controller instance. Own keys say whether it is a facade; prototype names
 * say whether the method exists one level up.
 */
function describeService(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value !== 'object') return `typeof ${typeof value}`
  const own = Object.keys(value as object)
  let proto: string[] = []
  try {
    let cursor = Object.getPrototypeOf(value as object) as object | null
    for (let depth = 0; cursor !== null && depth < 3; depth += 1) {
      proto = [...proto, ...Object.getOwnPropertyNames(cursor)]
      cursor = Object.getPrototypeOf(cursor) as object | null
    }
  } catch { /* prototypes can be exotic */ }
  const wanted = proto.filter(name => /attachment|draft|release/i.test(name))
  return `own=[${own.slice(0, 24).join(',')}] proto(${proto.length})=[${proto.slice(0, 24).join(',')}] draft-like=[${wanted.join(',')}]`
}

/**
 * Install the deferred-release wrapper.
 *
 * The lookup goes through `ctx.inject`, not a bare `ctx.get`: the `conversation`
 * service is registered by DSH's own conversation plugin, which applies *after*
 * this one, so a synchronous `get` at apply time returns `undefined`. A probe
 * caught exactly that (`typeof undefined`), and because the install ran only
 * once, nothing was ever wrapped — the feature silently did nothing.
 *
 * `inject` defers the callback until the service exists. Idempotent per page: a
 * second install on an already-wrapped service is a no-op, which matters because
 * the client face can be re-applied by a bundle reload.
 */
export function keepDraftAttachments(ctx: Context, pluginName: string): AttachmentRetentionStats {
  const stats: AttachmentRetentionStats = { installed: false, retained: 0, live: 0, deferred: 0, lastError: null }

  const install = (scope: Context): void => {
    if (stats.installed) return
    let conversation: ConversationFace | undefined
    try {
      conversation = scope.get('conversation' as never) as unknown as ConversationFace | undefined
    } catch (reason) {
      stats.lastError = `get(conversation): ${String(reason).slice(0, 100)}`
      return
    }
    if (conversation === undefined) {
      stats.probe = describeService(conversation)
      stats.lastError = 'conversation service is not reachable yet'
      return
    }
    if (typeof conversation.releaseDraftAttachment !== 'function') {
      stats.probe = describeService(conversation)
      stats.lastError = 'conversation service has no releaseDraftAttachment'
      return
    }
    const holder = conversation as ConversationFace & { __projectlessRetains?: Map<string, AttachmentLike> }
    if (holder.__projectlessRetains !== undefined) {
      stats.installed = true
      stats.retained = holder.__projectlessRetains.size
      return
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
      if (conversation?.draftAttachments?.get(id) === undefined) {
        // Nothing here to protect — either released before or never known. Let
        // the original run so unknown ids behave exactly as DSH expects.
        try { original(id) } catch { /* best effort */ }
        return
      }
      // Deliberately NOT calling the original: that is what keeps the entry in
      // the Map the render path reads, and keeps the blob URL unrevoked.
      retained.set(id, { id })
      stats.deferred += 1
      evict()
    }

    scope.effect(() => () => {
      retained.clear()
      delete holder.__projectlessRetains
    }, `${pluginName}: retained draft attachments`)

    stats.installed = true
    stats.lastError = null
    stats.probe = undefined
  }

  try {
    ctx.inject(['conversation' as never], install as never)
  } catch (reason) {
    stats.lastError = `inject(conversation): ${String(reason).slice(0, 100)}`
  }
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
