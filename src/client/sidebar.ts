import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { isProjectlessPath } from '../shared/paths.ts'
import { report } from './diagnostics.ts'
import { PROJECTLESS_LOCALE_NS } from './locales.ts'

/**
 * Sidebar behaviour that the picker cannot express on its own:
 *
 * 1) Position — DSH derives sidebar groups by appending the Ungrouped bucket
 *    after every Workspace group (`dsh-client-ui-workspace` `groupByWorkspace`),
 *    and that bucket carries no drag handle, so it can neither be reordered nor
 *    moved. The rows are plain block children of the `[role="tree"]` scroll
 *    container, which means `order` has no effect there either. The stylesheet
 *    below turns that container into a flex column so `order` applies, then
 *    lifts Ungrouped with `order: -1`. The selector keys off the row marker
 *    `data-row-key="workspace:"`, which DSH emits only for the Ungrouped
 *    section, so the rule is inert in every other sidebar view.
 *
 *    The temporary Workspace of a blank projectless Session is lifted above
 *    even that (`order: -2`), because a brand-new Session appearing *below* the
 *    loose-Session list is exactly what reads as "the new chat landed in the
 *    wrong place".
 *
 * 2) Order — DSH keeps ONE ordering mode for the whole sidebar. Under "manual"
 *    mode a group that owns a stored order freezes it, and DSH hands a stored
 *    order to *every* account the moment a blank Session is selected
 *    (`syncSessionOrders` writes the current rendered order back for all of
 *    them). That is what makes a workspace stop re-sorting by recency after the
 *    first new Session. This plugin rewrites an account's stored order whenever
 *    it no longer matches the current recency order, and only under "manual"
 *    mode: under "last updated" mode DSH already orders by recency, so nothing
 *    is written at all.
 */

/**
 * The slot whose registration carries the sidebar's view store. DSH declares
 * it internally, so it is not part of the published `SlotMap`; the string is
 * the contract this plugin relies on.
 */
const SIDEBAR_SLOT = 'sidebar.workspaces' as never

/** The container DSH renders the grouped sidebar rows into. */
const TREE = '[role="tree"]:has([data-row-key="workspace:"])'

/** Marks the sidebar section of the temporary projectless Workspace. */
const TEMP_ATTR = 'data-dsh-projectless-temp'

const CSS = [
  '/* dsh-projectless: keep Ungrouped above every workspace group, and the */',
  '/* projectless temporary Workspace above Ungrouped while it exists.      */',
  `${TREE}{display:flex;flex-direction:column}`,
  `${TREE}>*{flex:0 0 auto}`,
  `${TREE}>div:has([data-row-key="workspace:"]){order:-1}`,
  `${TREE}>div[${TEMP_ATTR}]{order:-2}`,
].join('\n')

/** The picker label in the active language, used as the temporary group's title. */
export function projectlessLabel(ctx: Context): string | undefined {
  try {
    const label = ctx.locale.bind(PROJECTLESS_LOCALE_NS)('picker.projectless')
    if (typeof label === 'string' && label !== '') return label
  } catch {
    // The dictionary is registered by this plugin's own apply; absence is fine.
  }
  return undefined
}

/** The final path segment — the label DSH shows before a Workspace gets renamed. */
function baseName(path: string): string {
  const segments = path.replace(/\\/g, '/').split('/').filter(segment => segment.length > 0)
  return segments[segments.length - 1] ?? ''
}

export function installStyles(ctx: Context, pluginName: string): void {
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.plugin = pluginName
    style.textContent = CSS
    document.head.appendChild(style)
    return () => { style.remove() }
  }, `${pluginName}: sidebar styles`)
}

/**
 * Tag the sidebar section owned by the temporary projectless Workspace, so the
 * stylesheet can lift it above Ungrouped.
 *
 * The section is recognised by its group label — this plugin's own localized
 * string — because the temporary Workspace id is not known ahead of time. The
 * tag is (re)applied on every Workspace list change, deferred past React's
 * commit by a timeout plus a frame.
 */
export function markTemporaryGroups(ctx: Context, pluginName: string): void {
  ctx.effect(() => {
    const mark = (): void => {
      const label = projectlessLabel(ctx)
      if (label === undefined) return
      let sections: NodeListOf<HTMLElement>
      try {
        sections = document.querySelectorAll<HTMLElement>('[role="tree"] > div')
      } catch {
        return
      }
      for (const section of sections) {
        let row: Element | null
        try {
          row = section.querySelector('[data-row-key^="workspace:"]')
        } catch {
          continue
        }
        const text = row === null ? '' : String(row.textContent ?? '').trim()
        if (text === label) section.setAttribute(TEMP_ATTR, '1')
        else section.removeAttribute(TEMP_ATTR)
      }
    }
    const schedule = (): void => {
      window.setTimeout(mark, 0)
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(mark)
    }
    let unsubscribe = (): void => {}
    try {
      unsubscribe = ctx.workspaces.list.subscribe(schedule) || (() => {})
    } catch {
      // The Workspace service is always present for a sidebar view.
    }
    schedule()
    return () => {
      try { unsubscribe() } catch { /* already gone */ }
      try {
        for (const section of document.querySelectorAll(`[${TEMP_ATTR}]`)) section.removeAttribute(TEMP_ATTR)
      } catch { /* DOM is gone */ }
    }
  }, `${pluginName}: tag the temporary workspace section`)
}

/**
 * Rename a freshly created projectless Workspace the moment it shows up, rather
 * than waiting for the provisioning round trip to finish.
 *
 * The picker renames it too, at the end of its own provisioning; this watcher
 * only makes the rename win the race, so the directory name (a `session-…`
 * label) does not sit on the sidebar for the whole of that trip.
 * @returns a stop function.
 */
export function watchTemporaryLabel(ctx: Context, label: string | undefined): () => void {
  if (label === undefined) return () => {}
  let stopped = false
  const fix = (): void => {
    if (stopped) return
    let items: readonly WorkspaceView[]
    try {
      items = ctx.workspaces.list.getSnapshot().items ?? []
    } catch {
      return
    }
    for (const workspace of items) {
      if (!isProjectlessPath(workspace.path)) continue
      if (workspace.title === label) continue
      if (workspace.title !== baseName(workspace.path)) continue
      try {
        void ctx.workspaces.rename(workspace.workspaceId, label).catch(() => {})
      } catch { /* the row is already gone */ }
    }
  }
  let unsubscribe = (): void => {}
  try {
    unsubscribe = ctx.workspaces.list.subscribe(fix) || (() => {})
  } catch { /* nothing to observe */ }
  fix()
  return () => {
    stopped = true
    try { unsubscribe() } catch { /* already gone */ }
  }
}

/**
 * Re-apply the group label until it sticks: a rename can be overtaken by the
 * Workspace list refresh that immediately follows provisioning, which leaves
 * the temporary directory basename (the `session-…` name) on the group.
 */
export function reconcileLabel(ctx: Context, sessionId: SessionId, label: string | undefined): void {
  if (label === undefined) return
  const attempt = (remaining: number): void => {
    let workspace: WorkspaceView | undefined
    try {
      workspace = (ctx.workspaces.list.getSnapshot().items ?? []).find(item => item.sessionIds.includes(sessionId))
    } catch {
      workspace = undefined
    }
    if (workspace !== undefined) {
      if (!isProjectlessPath(workspace.path)) return
      if (workspace.title === label) return
      try {
        void ctx.workspaces.rename(workspace.workspaceId, label).catch(() => {})
      } catch { /* the row is already gone */ }
    }
    if (remaining > 0) window.setTimeout(() => { attempt(remaining - 1) }, 400)
  }
  attempt(5)
}

/**
 * The sidebar's view-store instance: current viewing state (grouping mode,
 * ordering mode, stored per-account orders) plus the engine's own write set.
 * The slot registration carries it as `store`; the owner memoises `create()`,
 * so this always hands back the live instance.
 * @returns the instance, or undefined when the sidebar is not mounted.
 */
function workspaceViewInstance(ctx: Context): { getSnapshot: () => ViewSnapshot, subscribe: (fn: () => void) => () => void, store: { update: (fn: (draft: ViewDraft) => void) => void } } | undefined {
  let entries
  try {
    entries = ctx.slots.entries(SIDEBAR_SLOT)
  } catch {
    return undefined
  }
  for (const entry of entries ?? []) {
    const store = (entry as { options?: { store?: unknown }, store?: unknown })?.options?.store
      ?? (entry as { store?: unknown })?.store
    if (store === undefined || typeof (store as { create?: unknown }).create !== 'function') continue
    try {
      const instance = (store as { create: () => unknown }).create() as {
        store?: { update?: unknown }
        getSnapshot?: unknown
        subscribe?: unknown
      } | undefined
      if (instance === undefined || instance === null) continue
      if (instance.store === undefined || typeof instance.store.update !== 'function') continue
      if (typeof instance.getSnapshot !== 'function') continue
      return instance as never
    } catch { /* a different slot entry */ }
  }
  return undefined
}

interface ViewSnapshot {
  orderBy?: string | undefined
  sessionOrderByAccount?: Record<string, readonly string[]> | undefined
}

interface ViewDraft {
  sessionOrderByAccount?: Record<string, string[]> | undefined
}

/** Every account's members in "newest first" order, keyed by account ("" is Ungrouped). */
export function recencyOrders(ctx: Context): Record<string, string[]> {
  const sessions = ctx.sessions.list.getSnapshot()
  const workspaces = ctx.workspaces.list.getSnapshot()
  const byRecency = (ids: readonly string[] | undefined): string[] => (ids ?? [])
    .filter((id: string) => sessions.byId[id] !== undefined)
    .slice()
    .sort((a: string, b: string) => (sessions.byId[b]?.updatedAt ?? 0) - (sessions.byId[a]?.updatedAt ?? 0))
  const orders: Record<string, string[]> = {}
  const accounted = new Set<string>()
  for (const workspace of workspaces.items ?? []) {
    for (const id of workspace.sessionIds ?? []) accounted.add(id)
    orders[workspace.workspaceId] = byRecency(workspace.sessionIds)
  }
  orders[''] = byRecency((sessions.ids ?? []).filter((id: string) => !accounted.has(id)))
  return orders
}

function sameOrder(left: readonly string[] | undefined, right: readonly string[]): boolean {
  if (!Array.isArray(left) || left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) if (left[index] !== right[index]) return false
  return true
}

/**
 * Keep every account following "newest first" while DSH is in manual ordering
 * mode.
 *
 * Manual mode freezes any group that owns a stored order, and DSH hands one to
 * *every* account the moment a blank Session is selected (`syncSessionOrders`
 * writes the current rendered order back for all of them). That is what makes a
 * workspace stop re-sorting by recency after the first new Session: the stored
 * order wins from then on. Ungrouped additionally drifts on its own, since every
 * Session either joins it or leaves it.
 *
 * So this writer refreshes an account's stored order whenever it no longer
 * matches the current recency order. Only accounts that already own one are
 * touched — with no stored order DSH renders by recency anyway, and creating one
 * would be a change nobody asked for. Under "last updated" mode stored orders
 * are not consulted at all, and this writer stays idle.
 *
 * Trade-off: a manual drag on any group is overwritten by the next refresh. That
 * is deliberate — this plugin's position is that groups stay newest-first.
 */
export function keepRecencyOrder(ctx: Context, pluginName: string): void {
  ctx.effect(() => {
    let view: ReturnType<typeof workspaceViewInstance>
    let disposed = false
    let disposers: (() => void)[] = []
    let timers: number[] = []
    let warned = false
    const sync = (): void => {
      if (disposed || view === undefined) return
      let snapshot: ViewSnapshot
      try {
        snapshot = view.getSnapshot()
      } catch {
        return
      }
      if (snapshot === undefined || snapshot.orderBy !== 'manual') return
      const stored = snapshot.sessionOrderByAccount
      if (stored === undefined) return
      const changed: Record<string, string[]> = {}
      for (const [account, order] of Object.entries(recencyOrders(ctx))) {
        const current = stored[account]
        if (!Array.isArray(current) || sameOrder(current, order)) continue
        changed[account] = order
      }
      if (Object.keys(changed).length === 0) return
      try {
        view.store.update((draft) => {
          if (draft.sessionOrderByAccount === undefined) draft.sessionOrderByAccount = {}
          for (const [account, order] of Object.entries(changed)) draft.sessionOrderByAccount[account] = [...order]
        })
      } catch (reason) {
        console.warn(`${pluginName}: cannot refresh a stored order:`, reason)
      }
    }
    const attach = (): void => {
      if (disposed || view !== undefined) return
      const found = workspaceViewInstance(ctx)
      if (found === undefined) return
      view = found
      try { disposers.push(ctx.sessions.list.subscribe(sync)) } catch { /* service is going away */ }
      try { disposers.push(view.subscribe(sync)) } catch { /* service is going away */ }
      sync()
    }
    const attachOnce = (): void => {
      attach()
      if (view === undefined) {
        if (!warned) {
          warned = true
          console.warn(`${pluginName}: sidebar view store not found yet; will keep retrying`)
        }
        return
      }
      for (const timer of timers) window.clearTimeout(timer)
      timers = []
    }
    let stopSlots = (): void => {}
    try {
      stopSlots = ctx.slots.subscribe(SIDEBAR_SLOT, attachOnce) || (() => {})
    } catch { /* slots service is going away */ }
    // The sidebar registers its view store after this plugin's own apply (slot
    // registration is deferred until the parent slot is declared), and a
    // subscription does not re-fire for a slot that already exists, so a short
    // retry ladder covers both orders.
    attachOnce()
    for (const delay of [250, 1000, 3000, 8000]) timers.push(window.setTimeout(attachOnce, delay))
    return () => {
      disposed = true
      for (const timer of timers) window.clearTimeout(timer)
      timers = []
      try { stopSlots() } catch { /* already gone */ }
      for (const dispose of disposers) {
        try { dispose() } catch { /* already gone */ }
      }
      disposers = []
      view = undefined
    }
  }, `${pluginName}: keep every group in recency order`)
}

/**
 * Make an unqualified "new Session" open a projectless one.
 *
 * `uiWorkspace.startSession(workspaceId)` falls back to the current Session's
 * Workspace and then to the most recently used Workspace — never to a
 * projectless Session. This wrapper delegates an unqualified call to the
 * picker's own provisioning, while an explicit `workspaceId` (a group's "+")
 * keeps DSH's behaviour.
 */
export function installDefaultNewSession(
  ctx: Context,
  pluginName: string,
  startProjectless: () => Promise<SessionId>,
): void {
  ctx.effect(() => {
    const ui = ctx.uiWorkspace
    let fallback = ui.startSession
    if (typeof fallback !== 'function') return () => {}
    let inFlight = false
    const patched = function (this: unknown, workspaceId?: WorkspaceId): unknown {
      if (workspaceId !== undefined) {
        report(ctx, { phase: 'startSession', mode: 'explicit-workspace' })
        return fallback.call(ui, workspaceId)
      }
      report(ctx, { phase: 'startSession', mode: 'default' })
      if (inFlight) return undefined
      inFlight = true
      void Promise.resolve().then(() => startProjectless()).catch((reason: unknown) => {
        console.warn(`${pluginName}: projectless session failed:`, reason)
      }).finally(() => {
        inFlight = false
      })
      return undefined
    }
    ;(patched as { __dshProjectless?: boolean }).__dshProjectless = true

    /**
     * Keep the wrapper installed. Enabling the plugin again, or any reload that
     * rebuilds the `uiWorkspace` service, hands out a fresh object whose
     * `startSession` is DSH's own again — the effect would already have run, so
     * without this guard the override silently disappears while the plugin
     * still reads as active. A wrapper found underneath is preserved as the
     * fallback instead of being dropped.
     */
    const install = (): void => {
      if (ui.startSession === patched) return
      const current = ui.startSession
      if (typeof current !== 'function') return
      if ((current as { __dshProjectless?: boolean }).__dshProjectless !== true) fallback = current
      try {
        ui.startSession = patched as typeof ui.startSession
      } catch (reason) {
        console.warn(`${pluginName}: cannot override startSession:`, reason)
      }
    }
    install()
    const guard = window.setInterval(install, 2000)
    return () => {
      window.clearInterval(guard)
      if (ui.startSession === patched) {
        try {
          ui.startSession = fallback
        } catch { /* already gone */ }
      }
    }
  }, `${pluginName}: default new session to projectless`)
}
