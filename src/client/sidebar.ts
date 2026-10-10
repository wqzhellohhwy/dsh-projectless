import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { report } from './diagnostics.ts'

/**
 * Sidebar behaviour the picker cannot express on its own:
 *
 * 1) Position — DSH derives sidebar groups by appending the Ungrouped bucket
 *    after every Workspace group (`dsh-client-ui-workspace` `groupByWorkspace`),
 *    and that bucket carries no drag handle, so it can neither be reordered nor
 *    moved. Its rows are plain block children of the `[role="tree"]` scroll
 *    container, which means `order` has no effect there either. The stylesheet
 *    below turns that container into a flex column so `order` applies, then
 *    lifts Ungrouped above every Workspace group with `order: -1`. The selector
 *    keys off the row marker `data-row-key="workspace:"`, which DSH emits only
 *    for the Ungrouped section, so the rule is inert in every other view.
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

/** The slot whose registration carries the sidebar's view store. */
const SIDEBAR_SLOT = 'sidebar.workspaces' as never

/** The container DSH renders the grouped sidebar rows into. */
const TREE = '[role="tree"]:has([data-row-key="workspace:"])'

/**
 * The `display:flex` half is what makes `order` apply to the sidebar's block
 * rows. It was switched off while a blank sidebar was being diagnosed, and the
 * cause turned out to be the order *writer*, not this stylesheet — the empty
 * sidebar came from `keepRecencyOrder` re-entering itself, not from layout. It
 * is restored here, verified stable (sidebar still renders every group).
 */
const CSS = [
  '/* dsh-projectless: keep Ungrouped above every workspace group. */',
  `${TREE}{display:flex;flex-direction:column}`,
  `${TREE}>*{flex:0 0 auto}`,
  `${TREE}>div:has([data-row-key="workspace:"]){order:-1}`,
].join('\n')

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
 * The sidebar's view-store instance: current viewing state (grouping mode,
 * ordering mode, stored per-account orders) plus the engine's own write set.
 * The slot registration carries it as `store`; the owner memoises `create()`,
 * so this always hands back the live instance.
 */
function workspaceViewInstance(ctx: Context): {
  getSnapshot: () => ViewSnapshot
  subscribe: (fn: () => void) => () => void
  store: { update: (fn: (draft: ViewDraft) => void) => void }
} | undefined {
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
 * *every* account the moment a blank Session is selected. That is what makes a
 * workspace stop re-sorting by recency after the first new Session: the stored
 * order wins from then on. Ungrouped additionally drifts on its own, since
 * every Session either joins it or leaves it.
 *
 * So this writer refreshes an account's stored order whenever it no longer
 * matches the current recency order. Only accounts that already own one are
 * touched — with no stored order DSH renders by recency anyway, and creating one
 * would be a change nobody asked for. Under "last updated" mode stored orders
 * are not consulted at all, and this writer stays idle.
 *
 * Trade-off: a manual drag on any group is overwritten by the next refresh. That
 * is deliberate — this plugin's position is that groups stay newest-first.
 *
 * CAREFUL: this writer must never run against a half-loaded Session list. A
 * stored order is what the sidebar *renders* under manual mode, so writing the
 * recency order computed from an empty snapshot replaces every group's members
 * with `[]` — the sidebar then shows no rows at all until something writes a
 * real order back. Both snapshots therefore have to look ready, and a non-empty
 * stored order is never replaced by an empty computed one.
 */
export function keepRecencyOrder(ctx: Context, pluginName: string, write = true): void {
  ctx.effect(() => {
    let view: ReturnType<typeof workspaceViewInstance>
    let disposed = false
    let disposers: (() => void)[] = []
    let timers: number[] = []
    let warned = false
    /** Accounts whose order has already been refreshed once on this page. */
    const writtenAccounts = new Set<string>()
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
      let sessions: { phase?: string | undefined, ids?: readonly string[] | undefined } | undefined
      let workspaces: { phase?: string | undefined } | undefined
      try {
        sessions = ctx.sessions.list.getSnapshot() as { phase?: string, ids?: readonly string[] }
        workspaces = ctx.workspaces.list.getSnapshot() as { phase?: string }
      } catch {
        return
      }
      // Nothing is knowable before both lists have loaded.
      if (sessions?.phase !== undefined && sessions.phase !== 'ready') return
      if (workspaces?.phase !== undefined && workspaces.phase !== 'ready') return
      if ((sessions?.ids ?? []).length === 0) return
      const changed: Record<string, string[]> = {}
      for (const [account, order] of Object.entries(recencyOrders(ctx))) {
        const current = stored[account]
        if (!Array.isArray(current) || sameOrder(current, order)) continue
        // Never let a snapshot gap empty out a group that has members recorded.
        if (order.length === 0 && current.length > 0) continue
        // One write per account per page: a write that does not converge would
        // otherwise re-enter through the subscription that triggered it.
        if (writtenAccounts.has(account)) continue
        changed[account] = order
      }
      if (Object.keys(changed).length > 0) {
        for (const account of Object.keys(changed)) writtenAccounts.add(account)
      }
      if (Object.keys(changed).length === 0) return
      if (!write) {
        // Bisection mode: the store was located and read, but nothing is written.
        console.warn(`${pluginName}: order refresh suppressed (diagnostic), accounts=${Object.keys(changed).length}`)
        return
      }
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
 * Make an unqualified "new Session" start a projectless one.
 *
 * `uiWorkspace.startSession(workspaceId)` falls back to the current Session's
 * Workspace and then to the most recently used Workspace — and with nothing to
 * fall back to it clears the main view rather than creating a Session. This
 * wrapper delegates an unqualified call to the picker's own provisioning, while
 * an explicit `workspaceId` (a group's "+") keeps DSH's behaviour.
 */
export function installDefaultNewSession(
  ctx: Context,
  pluginName: string,
  startProjectless: () => Promise<SessionId>,
  ready: () => boolean = () => true,
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
      // A projectless Session is only usable once the composer gate is in
      // place: without it the input bar stays inert, and a brand-new Session
      // nobody can type into is worse than DSH's own behaviour. So the default
      // is only diverted while the override is actually registered.
      if (!ready()) {
        report(ctx, { phase: 'startSession', mode: 'fallback-gate-not-ready' })
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
