import type { Context } from '@deepseek-ai/cordis'

/**
 * Keep a *pasted-image draft* across Session switches — and let go when the user
 * actually deletes it.
 *
 * ## The problem
 *
 * Text drafts survive navigation because DSH mirrors them into `localStorage`.
 * Attachments have no such mirror: an image lives only in memory, as a `Map`
 * entry plus a blob URL, and `releaseDraftAttachment(id)`
 * (lib/client.js:3637) destroys both irreversibly —
 *
 *   this.draftAttachments.delete(id);        // the bytes are gone
 *   revokePreview(attachment.previewUrl);    // and the URL is dead for good
 *
 * and a rebuilt input shell starts with an empty `attachmentIds`, so even kept
 * bytes would not be drawn.
 *
 * ## Why the naive fix was wrong
 *
 * Blanket-intercepting `releaseDraftAttachment` kept the bytes alive — but it
 * also kept images the user had *deliberately deleted*, and a never-expiring
 * "remembered ids" table put stale images back into unrelated Sessions. Both
 * symptoms came from treating one function as if it had one meaning, when it is
 * reached from four different places:
 *
 * | origin                         | path                                     | wanted    |
 * | ------------------------------ | ---------------------------------------- | --------- |
 * | user removes an attachment      | `shell.removeAttachment` → release       | destroyed |
 * | Session switch tears down shell | `shell.dispose()` → release              | kept      |
 * | prompt sent (attachments used)  | `commandAttachments.release` → release   | destroyed |
 * | hand-off to another Workspace   | new shell adopts, then `removeAttachment`| destroyed |
 *
 * Only one origin is not preceded by `shell.removeAttachment`. That is the
 * discriminator this module uses:
 *
 * 1. `shell.dispose` — before it runs, put that shell's attachment ids into a
 *    **protected** set and remember them for the Session;
 * 2. `shell.removeAttachment` — a deliberate removal, so **unprotect** the id;
 * 3. `releaseDraftAttachment` — intercept **only protected ids**; everything
 *    else goes straight through to the original and is really destroyed.
 *
 * Restoration is deliberately narrow: it happens the **first time a given shell
 * object is seen** (a rebuilt shell is a new object), and the remembered entry
 * is consumed on use. A shell that is already known is never re-populated, so
 * deleting every image cannot resurrect them.
 */

/** How many intercepted releases stay resolvable before the oldest is dropped. */
const RETAINED_LIMIT = 64

/** How many Sessions may hold a pending restore entry at once. */
const REMEMBERED_LIMIT = 16

interface AttachmentLike {
  id: string
  kind?: string
  previewUrl?: string
  [key: string]: unknown
}

/** The slice of DSH's per-Session input shell this module touches. */
interface ShellLike {
  snapshot?: { attachmentIds?: readonly string[], draft?: string } | undefined
  addAttachments?: (ids: readonly string[]) => unknown
  removeAttachment?: (id: string) => unknown
  dispose?: () => unknown
  /** Marks a shell already wrapped, so a repeat `shell(id)` is a no-op. */
  __projectlessShellHook?: boolean
}

interface ConversationFace {
  draftAttachments?: Map<string, AttachmentLike>
  releaseDraftAttachment?: (id: string) => void
  input?: { shell?: (id: string) => ShellLike | undefined }
}

export interface AttachmentRetentionStats {
  /** Whether the conversation service was reached and the wrappers installed. */
  installed: boolean
  /** Attachments currently held alive by this wrapper. */
  retained: number
  /** Live draft attachments DSH still owns. */
  live: number
  /** Releases intercepted because they came from a shell teardown. */
  deferred: number
  /** Times a rebuilt shell had its remembered ids put back. */
  restored: number
  /** Deliberate removals (the × on a thumbnail, or a Workspace hand-off). */
  forgotten: number
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
 * Install the wrappers.
 *
 * The lookup goes through `ctx.inject`, not a bare `ctx.get`: the `conversation`
 * service is registered by DSH's own conversation plugin, which applies *after*
 * this one, so a synchronous `get` at apply time returns `undefined` (a probe
 * caught exactly that, and the feature silently did nothing).
 *
 * Idempotent per page: a second install on an already-wrapped service is a
 * no-op, which matters because the client face can be re-applied by a reload.
 */
export function keepDraftAttachments(ctx: Context, pluginName: string): AttachmentRetentionStats {
  const stats: AttachmentRetentionStats = {
    installed: false, retained: 0, live: 0, deferred: 0, restored: 0, forgotten: 0, lastError: null,
  }

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

    /** Ids whose release came from a shell teardown, so they must survive it. */
    const protectedIds = new Set<string>()
    /** Session id → ids to put back the next time that Session's shell appears. */
    const remembered = new Map<string, string[]>()

    const evict = (): void => {
      while (retained.size > RETAINED_LIMIT) {
        const oldest = retained.keys().next()
        if (oldest.done === true) break
        const id = oldest.value
        retained.delete(id)
        protectedIds.delete(id)
        try {
          original(id)
        } catch { /* the original is best-effort */ }
      }
    }

    // (3) The only interception point: ids explicitly protected by a teardown.
    conversation.releaseDraftAttachment = (id: string): void => {
      if (!protectedIds.has(id) || conversation?.draftAttachments?.get(id) === undefined) {
        // Deliberate removal, an attachment we never held, or an id already
        // dropped by the LRU — let the original destroy it, as DSH intends.
        protectedIds.delete(id)
        try { original(id) } catch { /* best effort */ }
        return
      }
      retained.set(id, { id })
      stats.deferred += 1
      evict()
    }

    const inputFace = conversation.input
    if (inputFace !== undefined && typeof inputFace.shell === 'function') {
      const shellFor = inputFace.shell.bind(inputFace)
      inputFace.shell = (id: string): ShellLike | undefined => {
        let shell: ShellLike | undefined
        try {
          shell = shellFor(id)
        } catch {
          return undefined
        }
        if (shell === undefined || shell === null) return shell
        // A rebuilt shell is a new object, so this branch runs once per shell.
        if (shell.__projectlessShellHook === true) return shell
        shell.__projectlessShellHook = true

        // (1) Teardown: protect this shell's attachments, and remember the ids
        // for the Session so a fresh shell can be repopulated exactly once.
        const originalDispose = typeof shell.dispose === 'function' ? shell.dispose.bind(shell) : undefined
        if (originalDispose !== undefined) {
          shell.dispose = (): unknown => {
            const ids = shell?.snapshot?.attachmentIds
            if (Array.isArray(ids) && ids.length > 0) {
              for (const one of ids) protectedIds.add(one)
              remembered.set(id, [...ids])
              while (remembered.size > REMEMBERED_LIMIT) {
                const oldest = remembered.keys().next()
                if (oldest.done === true) break
                remembered.delete(oldest.value)
              }
            }
            return originalDispose()
          }
        }

        // (2) Deliberate removal: the user (or a Workspace hand-off) really does
        // not want this attachment, so stop protecting it.
        const originalRemove = typeof shell.removeAttachment === 'function'
          ? shell.removeAttachment.bind(shell)
          : undefined
        if (originalRemove !== undefined) {
          shell.removeAttachment = (attachmentId: string): unknown => {
            // Counted unconditionally: this call *is* the "deliberately gone"
            // signal, whether or not the id happened to be protected at the
            // time (a plain delete never protects anything first).
            protectedIds.delete(attachmentId)
            stats.forgotten += 1
            return originalRemove(attachmentId)
          }
        }

        // Restoration: consumed on use, and only into a shell that has nothing —
        // a shell we already know never reaches here, so deleting every image
        // cannot bring them back.
        const stale = remembered.get(id)
        if (stale !== undefined) {
          remembered.delete(id)
          if ((shell.snapshot?.attachmentIds?.length ?? 0) === 0 && stale.length > 0) {
            try {
              shell.addAttachments?.(stale)
              stats.restored += 1
            } catch { /* the shell may refuse ids it no longer knows */ }
          }
        }
        return shell
      }
    }

    scope.effect(() => () => {
      retained.clear()
      protectedIds.clear()
      remembered.clear()
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

/** Read DSH's draft-attachment Map size right now (not the cached counter). */
export function liveAttachmentCount(ctx: Context): number {
  try {
    const conversation = ctx.get('conversation' as never) as unknown as ConversationFace | undefined
    return conversation?.draftAttachments?.size ?? -1
  } catch {
    return -1
  }
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
