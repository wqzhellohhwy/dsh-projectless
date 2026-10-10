import * as React from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/**
 * Reopen the composer for a blank Session that belongs to no Workspace.
 *
 * `dsh-client-ui-conversation` decides whether the input bar is usable with
 *
 *     const inert = sessionId === void 0 || (hero && chipTitle === void 0)
 *
 * where `chipTitle` resolves to the Session's Workspace title, and — once the
 * Workspace list has loaded — never falls back to anything else. A blank
 * Session with no Workspace therefore renders an inert textarea whose
 * placeholder asks the user to pick a Workspace, even though the Session
 * already carries a usable `cwd`.
 *
 * That decision reaches the input bar as a plain `disabled` prop on the
 * `conversation.composer.bar` slot, so this module registers that slot with a
 * lower priority (which wins), keeps DSH's own component, and forwards every
 * prop unchanged — except that `disabled` is dropped for exactly the Sessions
 * this plugin created: no Workspace, but a real `cwd`.
 *
 * It is deliberately narrow: anything with a Workspace, anything the Host
 * reports as cwd-less, and every non-hero composer keep DSH's own value.
 */

const COMPOSER_BAR_SLOT = 'conversation.composer.bar'

export interface ComposerGateDeps {
  /** The Session the main view currently retains, if any. */
  currentSessionId(): SessionId | undefined
  /** That Session's working directory, if it has one. */
  cwdOf(sessionId: SessionId): string | undefined
  /** Whether that Session is registered against a Workspace. */
  hasWorkspace(sessionId: SessionId): boolean
  /**
   * Projectless Sessions this page started that are still blank and still
   * belong to no Workspace — one of them is what an inert composer belongs to.
   *
   * DSH hands this slot no Session id at all while such a Session is open
   * (its scope is `session-maybe`, and the id reads `undefined`), so the gate
   * cannot ask "is *this* composer an orphan". It asks the next best thing:
   * "is there a live orphan at all", which only ever matters while a composer
   * DSH already declared inert is on screen.
   */
  liveOrphans(): readonly SessionId[]
}

export interface ComposerGateStats {
  /** Times the gate actually turned an inert composer back on. */
  opened: number
  /** Whether DSH's own input bar was found to delegate to. */
  borrowed: boolean
  /** Times the gate rendered at all (0 means the composer slot never rendered). */
  rendered: number
  /** Registration attempts, and how many entries the slot reported to them. */
  syncs: number
  entriesSeen: number
  /** Whether the override was accepted by the slot registry. */
  registered: boolean
  lastError: string | null
  /** Most recent gate decision, for diagnosing a gate that never opens. */
  probe: string | null
}

type AnyProps = Record<string, unknown>

/**
 * DSH's input bar is `React.memo(...)`, so a slot entry's `component` is the
 * memo object — `typeof` reports `'object'`, not `'function'`. Anything React
 * can render counts: a plain function component, or an element-type object
 * (memo / forwardRef) carrying the `$$typeof` brand.
 */
function isRenderable(value: unknown): boolean {
  if (typeof value === 'function') return true
  return typeof value === 'object' && value !== null && '$$typeof' in (value as object)
}

interface SlotEntry {
  options?: { priority?: number, children?: unknown, config?: unknown } | undefined
  inject?: unknown
  locale?: unknown
  component?: unknown
}

/**
 * Install the slot override.
 *
 * DSH registers the built-in input bar on this slot at the default priority, so
 * a negative priority takes over rendering. Whatever DSH declared for the
 * built-in entry (`inject`, `locale`, `children`) is copied onto this one, so
 * the component below receives the same injected props and the composer's own
 * child slots keep resolving.
 */
export function installComposerGate(
  ctx: Context,
  pluginName: string,
  deps: ComposerGateDeps,
  stats: ComposerGateStats,
): void {
  /**
   * DSH's own input bar, captured once when the slot is registered. Rendering
   * it is the whole point of the override, so it is resolved up front and the
   * override is simply not installed when it cannot be found — a gate that
   * renders `null` would remove the composer instead of reopening it.
   */
  let builtin: unknown
  /** Rolling trace of the last few gate renders, for diagnostics. */
  const trace: string[] = []

  const ComposerGate = (props: AnyProps): unknown => {
    stats.rendered += 1
    // Never render nothing: this component is the only thing the slot will
    // render, so bailing out would remove the composer instead of gating it.
    if (!isRenderable(builtin)) return null
    // The slot rendering hands the component the Session it belongs to, exactly
    // as it does for DSH's own input bar; guessing the current Session from
    // `retainedBy` does not survive every DSH build.
    const sessionId = (props.sessionId ?? props.projectlessSessionId) as SessionId | undefined
    const cwd = sessionId === undefined ? undefined : deps.cwdOf(sessionId)
    const owned = sessionId === undefined ? undefined : deps.hasWorkspace(sessionId)
    const identified = sessionId !== undefined && owned === false && typeof cwd === 'string' && cwd !== ''
    let orphans: readonly SessionId[] = []
    try {
      orphans = deps.liveOrphans()
    } catch {
      orphans = []
    }
    // Two ways in: the slot named a Session and it is an orphan, or the slot
    // named none (which is exactly what it does for a projectless Session)
    // while a live orphan exists.
    const parentless = identified || (sessionId === undefined && orphans.length > 0)
    // A short render trace: it shows whether the composer was re-rendered at
    // all while a projectless Session was open.
    trace.push(`${sessionId === undefined ? 'nil' : String(sessionId).slice(8, 16)}/${props.disabled === true ? 'D' : '-'}/${orphans.length}`)
    if (trace.length > 8) trace.shift()
    stats.probe = trace.join(' ')
    if (!parentless || props.disabled !== true) return React.createElement(builtin as never, props)
    stats.opened += 1
    const next: AnyProps = { ...props, disabled: false, workspacePickerOpen: false }
    delete next.onRequestWorkspace
    // DSH's own hero placeholder, taken from its own dictionary.
    const t = props.t
    if (typeof t === 'function') {
      try {
        next.placeholder = (t as (key: string) => string)('placeholder.hero')
      } catch { /* older dictionary: keep DSH's own placeholder */ }
    } else {
      delete next.placeholder
    }
    return React.createElement(builtin as never, next)
  }

  /**
   * Registration is driven by the slot itself rather than by a one-shot
   * `slots.inject` callback: the conversation view declares this slot when it
   * first renders, so a plugin that arrives later — a reloaded bundle, an
   * enabled plugin, a second window — would never get its callback.
   * `slots.subscribe` fires for both a late declaration and a later entry
   * change, and registering before the declaration is equally fine.
   */
  ctx.effect(() => {
    let dispose: (() => void) | undefined
    let borrowed: unknown
    const sync = (): void => {
      stats.syncs += 1
      let entries: readonly SlotEntry[]
      try {
        entries = [...(ctx.slots.entries(COMPOSER_BAR_SLOT) ?? [])] as readonly SlotEntry[]
      } catch (reason) {
        stats.lastError = `entries: ${String(reason).slice(0, 100)}`
        return
      }
      stats.entriesSeen = entries.length
      const found = entries.find(entry => isRenderable(entry.component) && entry.component !== ComposerGate)
      if (found === undefined) return
      if (dispose !== undefined && borrowed === found.component) return
      builtin = found.component
      borrowed = found.component
      stats.borrowed = true
      const options: Record<string, unknown> = {
        name: COMPOSER_BAR_SLOT,
        priority: -1,
      }
      if (found.options?.children !== undefined) options.children = found.options.children
      if (found.locale !== undefined) options.locale = found.locale
      // DSH calls a slot's `inject` with the Session the slot belongs to. This
      // wrapper keeps every prop the built-in input bar needs and adds the one
      // fact it does not publish: which Session this composer is for.
      const upstream = found.inject
      options.inject = (sessionId?: SessionId): Record<string, unknown> => ({
        ...(typeof upstream === 'function'
          ? (upstream as (id?: SessionId) => Record<string, unknown>)(sessionId)
          : {}),
        projectlessSessionId: sessionId,
      })
      try {
        dispose?.()
      } catch { /* the previous registration is already gone */ }
      try {
        dispose = ctx.slots.register(options as never, ComposerGate as never)
        stats.registered = true
      } catch (reason) {
        dispose = undefined
        stats.registered = false
        stats.lastError = `register: ${String(reason).slice(0, 140)}`
        console.warn(`${pluginName}: cannot register the composer gate:`, reason)
      }
    }
    let unsubscribe = (): void => {}
    try {
      unsubscribe = ctx.slots.subscribe(COMPOSER_BAR_SLOT as never, sync) || (() => {})
    } catch (reason) {
      stats.lastError = `subscribe: ${String(reason).slice(0, 100)}`
    }
    // A late declaration, a slot that was already declared, and a component
    // that only mounts once a Session is open all have to be covered, so the
    // subscription is backed by a short retry ladder.
    const timers = [200, 800, 2000, 5000, 10000].map(delay => window.setTimeout(sync, delay))
    const interval = window.setInterval(sync, 5000)
    sync()
    return () => {
      for (const timer of timers) window.clearTimeout(timer)
      window.clearInterval(interval)
      try { unsubscribe() } catch { /* already gone */ }
      try { dispose?.() } catch { /* already gone */ }
      dispose = undefined
    }
  }, `${pluginName}: composer gate`)
}
