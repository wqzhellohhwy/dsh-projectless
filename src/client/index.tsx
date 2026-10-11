import * as React from 'react'
import { useCallback, useState } from 'react'
import type { RefObject } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {
  HostObservable,
  PropsHooks,
  PropsLocale,
  PropsRenderSlots,
  PropsRuntime,
  StoredEntry,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { DirectoryFlowOwnerProps, UiWorkspace } from '@deepseek-ai/dsh-client-ui-workspace/client'
import {
  Button,
  IconFolderCloseRegular,
  IconNewChatOutlineRegular,
  IconPlusOutlineRegular,
  Menu,
  Modal,
  type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  PROJECTLESS_ENTRY_ID,
  createProjectlessSession,
  requestGroupDirectory,
  requestProjectlessDirectory,
  requestProjectlessRoot,
  workspaceOfSession,
} from './session.ts'
import { installComposerGate, type ComposerGateStats } from './composer.ts'
import { isProjectlessPath } from '../shared/paths.ts'
import { report, type DiagnosticsReply } from './diagnostics.ts'
import { runProjectlessSelftest } from './selftest.ts'
import { PROJECTLESS_LOCALE_NS, projectlessLocales } from './locales.ts'
import {
  installDefaultNewSession,
  installStyles as installSidebarStyles,
  keepRecencyOrder,
  recencyOrders,
} from './sidebar.ts'

const PACKAGE_ID = 'dsh-projectless'
const VERSION = '1.0.0'
/** Bumped on every build so a stale page is distinguishable from a fresh one. */
const BUILD = 44
/**
 * Run the self-test on every page load. Always false in a build that is meant
 * to be used: the self-test opens and closes real Sessions on screen, so it
 * only runs when the Host hands out the `projectless-selftest` command.
 */
const FORCE_SELFTEST = false
/**
 * DIAGNOSTIC BUILD ONLY: observe the sidebar and report it, installing nothing.
 *
 * The sidebar renders no groups at all on the affected machine, and this
 * variant exists to answer one question from outside the page: does a plugin
 * that only reads state still see an empty sidebar? No stylesheet, no slot
 * registration, no store write, no override — just a periodic self-report.
 */
const PROBE_ONLY = false
/**
 * BISECTION SWITCHES, diagnostic build only. The sidebar rendered no groups at
 * all with every feature installed, so each group is switched on separately to
 * find which one breaks it. All three are true in a normal build.
 */
const ENABLE_UI = true
const ENABLE_ORDER = true
const ENABLE_SESSION = true
/** Bisection: locate the sidebar view store but never write to it. */
const ENABLE_ORDER_WRITE = true
const TREE_ROW = '[data-row-key="workspace:"]'
const PROJECTLESS = PROJECTLESS_ENTRY_ID
const ADD_WORKSPACE = '::add-workspace'
const DSH_DIRECTORY_FLOW = 'conversation.hero.workspace.directoryFlow'
const DIRECTORY_FLOW = 'dsh-projectless.directoryFlow'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** This picker's own directory-flow hole, mirrored from DSH's hero hole. */
    'dsh-projectless.directoryFlow': {
      kind: 'single'
      scope: 'root'
      owner: DirectoryFlowOwnerProps
    }
  }
}

interface PickerActions {
  createWorkspace(input: { path: string }): Promise<WorkspaceView>
  createProjectlessSession(): Promise<SessionId>
  hooks: {
    directoryFlow: HostObservable<boolean>
  }
}

type PickerProps =
  PropsRuntime<'conversation.hero.workspace'>
  & PropsRenderSlots<typeof DIRECTORY_FLOW>
  & Omit<PickerActions, 'hooks'>
  & PropsHooks<PickerActions['hooks']>
  & PropsLocale<typeof PROJECTLESS_LOCALE_NS>

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

/** Shadow-compatible replacement for the built-in WorkspacePicker. */
function ProjectlessWorkspacePicker({
  open,
  anchorRef,
  selectedId,
  onPick,
  onClose,
  useWorkspaces,
  createWorkspace,
  createProjectlessSession,
  useDirectoryFlow,
  renderSlot,
  t,
}: PickerProps) {
  const workspaceState = useWorkspaces((state: { items: readonly WorkspaceView[] }) => state)
  const [busy, setBusy] = useState(false)
  const [flowOpen, setFlowOpen] = useState(false)
  const [modalError, setModalError] = useState<string | null>(null)
  const getAnchorRect = useCallback(
    () => (anchorRef as RefObject<HTMLElement | null> | undefined)?.current?.getBoundingClientRect() ?? null,
    [anchorRef],
  )

  const workspaceItems: MenuEntry[] = (workspaceState.items ?? []).map((workspace: WorkspaceView) => ({
    id: workspace.workspaceId,
    label: workspace.title,
    icon: <IconFolderCloseRegular size={16} />,
    disabled: busy,
  }))
  const flowAvailable = useDirectoryFlow((occupied: boolean) => occupied)
  React.useEffect(() => {
    if (flowOpen && !flowAvailable) setFlowOpen(false)
  }, [flowOpen, flowAvailable])
  const footer: MenuEntry[] = [
    {
      id: PROJECTLESS,
      label: t('picker.projectless'),
      icon: <IconNewChatOutlineRegular size={16} />,
      disabled: busy,
    },
    ...flowAvailable ? [
      { type: 'separator' as const, id: 'projectless-separator' },
      {
        id: ADD_WORKSPACE,
        label: t('picker.addWorkspace'),
        icon: <IconPlusOutlineRegular size={16} />,
        disabled: busy,
      },
    ] : [],
  ]

  const run = (operation: () => Promise<void>): void => {
    if (busy) return
    setBusy(true)
    void operation().catch((reason: unknown) => {
      setModalError(errorMessage(reason))
    }).finally(() => {
      setBusy(false)
    })
  }

  const handleSelect = (id: string): void => {
    if (id === PROJECTLESS) {
      onClose()
      run(async () => { await createProjectlessSession() })
      return
    }
    if (id === ADD_WORKSPACE) {
      onClose()
      setModalError(null)
      setFlowOpen(true)
      return
    }
    onPick(id as WorkspaceId)
  }

  const directoryFlowOwner: DirectoryFlowOwnerProps = {
    open: flowOpen,
    busy,
    onPicked: path => {
      run(async () => {
        try {
          const workspace = await createWorkspace({ path })
          onPick(workspace.workspaceId)
        } finally {
          setFlowOpen(false)
        }
      })
    },
    onCancel: () => { setFlowOpen(false) },
    onError: message => {
      setFlowOpen(false)
      setModalError(message)
    },
  }

  return (
    <>
      <Menu
        open={open}
        anchor={null}
        items={workspaceItems}
        footer={footer}
        selectedId={selectedId}
        onSelect={handleSelect}
        onClose={onClose}
        side="bottom"
        portal
        getAnchorRect={getAnchorRect}
      />
      {renderSlot(DIRECTORY_FLOW, directoryFlowOwner)}
      <Modal
        open={modalError !== null}
        onClose={() => { setModalError(null) }}
        closeLabel={t('modal.close')}
        title={t('modal.createFailed')}
        footer={(
          <Button variant="primary" onClick={() => { setModalError(null) }}>
            {t('modal.close')}
          </Button>
        )}
      >
        <div className="dsh-projectless-error" role="alert">{modalError}</div>
      </Modal>
    </>
  )
}

function installPickerCss(): () => void {
  const style = document.createElement('style')
  style.dataset.plugin = PACKAGE_ID
  style.textContent = `
    .dsh-projectless-error {
      margin-top: 8px;
      color: var(--dsw-alias-state-error-primary);
      font-size: 12px;
      line-height: 18px;
      overflow-wrap: anywhere;
    }
  `
  document.head.appendChild(style)
  return () => { style.remove() }
}

type LooseRegister = (options: Record<string, unknown>, component: unknown) => () => void

/**
 * DSH 0.2 lets exactly one entry declare a hole and render only holes it
 * declared, and the built-in picker already declares the hero directory-flow
 * hole. Re-register whatever occupies that hole (the native chooser or the
 * in-app browser) into this picker's own hole so "Add workspace…" keeps the
 * composed picking interaction.
 */
function mirrorDirectoryFlow(slots: SlotRegistry): () => void {
  const register = slots.register.bind(slots) as unknown as LooseRegister
  let mirrored: readonly StoredEntry[] | undefined
  let disposers: (() => void)[] = []
  const release = (): void => {
    for (const dispose of disposers) dispose()
    disposers = []
  }
  const sync = (): void => {
    const entries = slots.entries(DSH_DIRECTORY_FLOW)
    if (entries === mirrored) return
    mirrored = entries
    release()
    disposers = entries.map(entry => register({
      name: DIRECTORY_FLOW,
      ...entry.options.priority === undefined ? {} : { priority: entry.options.priority },
      ...entry.inject === undefined ? {} : { inject: entry.inject },
      ...entry.locale === undefined ? {} : { locale: entry.locale },
    }, entry.component))
  }
  const unsubscribe = slots.subscribe(DSH_DIRECTORY_FLOW, sync)
  sync()
  return () => {
    unsubscribe()
    release()
  }
}

export const name = PACKAGE_ID
export const inject = ['connection', 'locale', 'slots', 'sessions', 'workspaces', 'uiWorkspace']

/**
 * Post the Client face's own state to the Host: the only way to tell "the
 * plugin never ran", "it ran but the sidebar store was missing", "it ran and is
 * enforcing the order" and "the composer gate is open" apart from outside the
 * page.
 */
async function selfCheck(
  ctx: Context,
  phase: string,
  gate: ComposerGateStats,
): Promise<DiagnosticsReply | undefined> {
  let orderBy: string | null = null
  let storedAccounts: Record<string, { members: number, outOfRecency: number }> | null = null
  try {
    const view = sidebarViewFor(ctx)
    if (view !== undefined) {
      const snapshot = view.getSnapshot()
      orderBy = snapshot.orderBy ?? null
      const stores = snapshot.sessionOrderByAccount ?? {}
      const recency = recencyOrders(ctx)
      storedAccounts = Object.fromEntries(Object.entries(stores).map(([key, value]) => {
        const stored = Array.isArray(value) ? value : []
        const target = recency[key] ?? []
        return [key === '' ? '(ungrouped)' : key.slice(0, 8), {
          members: stored.length,
          outOfRecency: stored.filter((id, index) => id !== target[index]).length,
        }]
      }))
    }
  } catch { /* the sidebar is not mounted yet */ }
  let sidebarSections = -1
  let ungroupless = 0
  try {
    sidebarSections = document.querySelectorAll('[role="tree"] > div').length
    for (const section of document.querySelectorAll('[role="tree"] > div')) {
      if (section.querySelector(TREE_ROW) !== null) {
        ungroupless = section.querySelectorAll('[data-row-key^="session:"]').length
      }
    }
  } catch { /* no document yet */ }
  const ui = ctx.uiWorkspace
  let blankWithoutWorkspace = 0
  let current: SessionId | null = null
  let currentHasWorkspace = false
  try {
    const sessions = ctx.sessions.list.getSnapshot()
    const workspaces = ctx.workspaces.list.getSnapshot().items ?? []
    current = currentSessionId(ctx) ?? null
    currentHasWorkspace = current === null ? false : workspaceOfSession(workspaces, current) !== undefined
    for (const id of sessions.ids ?? []) {
      if (sessions.byId[id]?.blank !== true) continue
      if (workspaceOfSession(workspaces, id) === undefined) blankWithoutWorkspace += 1
    }
  } catch { /* services are going away */ }
  return await report(ctx, {
    phase,
    plugin: `${PACKAGE_ID}@${VERSION}`,
    build: BUILD,
    url: String((typeof location === 'undefined' ? undefined : location.href) ?? ''),
    wrapperInstalled: typeof ui?.startSession === 'function'
      && (ui.startSession as { __dshProjectless?: boolean }).__dshProjectless === true,
    composerChain: (() => {
      try {
        const entries = [...(ctx.slots.entries('conversation.composer' as never) ?? [])]
        if (entries.length === 0) return '(none)'
        const nameOf = (component: unknown): string => {
          if (typeof component === 'function') return (component as { name?: string }).name ?? 'fn'
          if (typeof component === 'object' && component !== null) {
            const shape = component as { displayName?: string, type?: { name?: string } }
            return shape.displayName ?? shape.type?.name ?? 'obj'
          }
          return typeof component
        }
        return entries.map((entry) => {
          const options = (entry as { options?: { name?: unknown, priority?: unknown, inject?: unknown } }).options
          const hasInject = options?.inject !== undefined ? 'i' : '-'
          return `${nameOf((entry as { component?: unknown }).component)}#${String(options?.priority ?? '-')}${hasInject}`
        }).join(',')
      } catch (reason) {
        return `err:${String(reason).slice(0, 60)}`
      }
    })(),
    composerGate: { borrowed: gate.borrowed, opened: gate.opened, rendered: gate.rendered, syncs: gate.syncs, entriesSeen: gate.entriesSeen, registered: gate.registered, lastError: gate.lastError, probe: gate.probe },
    orderBy,
    storedAccounts,
    sidebarSections,
    ungrouplessSessions: ungroupless,
    blankWithoutWorkspace,
    current,
    currentHasWorkspace,
  })
}

/** The Session the main view currently retains. */
function currentSessionId(ctx: Context): SessionId | undefined {
  try {
    const sessions = ctx.sessions.list.getSnapshot()
    return (sessions.ids ?? []).find((id: string) => (sessions.byId[id]?.retainedBy?.mainView ?? 0) > 0)
  } catch {
    return undefined
  }
}

/** The sidebar view store, or undefined while it is not registered. */
function sidebarViewFor(ctx: Context): {
  getSnapshot: () => { orderBy?: string | undefined, sessionOrderByAccount?: Record<string, readonly string[]> | undefined }
} | undefined {
  try {
    for (const entry of ctx.slots.entries('sidebar.workspaces' as never) ?? []) {
      const store = (entry as { options?: { store?: unknown }, store?: unknown }).options?.store
        ?? (entry as { store?: unknown }).store
      if (store === undefined) continue
      const instance = (store as { create?: () => unknown }).create?.()
      if (instance === undefined || instance === null) continue
      const candidate = instance as { getSnapshot?: () => never, store?: unknown }
      if (typeof candidate.getSnapshot !== 'function' || candidate.store === undefined) continue
      return candidate as never
    }
  } catch { /* not mounted */ }
  return undefined
}

/** Install the picker; DSH's built-in priority 0 picker remains the fallback. */
export function apply(ctx: Context): void {
  console.info(`${PACKAGE_ID}: client face applied`)
  const ui: UiWorkspace = ctx.uiWorkspace
  const rpc = ctx.connection.rpc as unknown as ClientConnectionRpc
  const gate: ComposerGateStats = { opened: 0, borrowed: false, rendered: 0, syncs: 0, entriesSeen: -1, registered: false, lastError: null, probe: null }
  let rootPromise: Promise<string> | undefined
  const projectlessRoot = (): Promise<string> => (rootPromise ??= requestProjectlessRoot(rpc))

  /** Projectless Sessions this page started; pruned as they stop qualifying. */
  const orphanSessions = new Set<SessionId>()

  /**
   * The tracked Sessions that are still blank and still belong to no Workspace.
   * A Session that has been sent to, deleted, or claimed by a Workspace drops
   * out for good, so the composer gate only ever opens for a Session that can
   * actually accept the prompt.
   */
  const liveOrphans = (): SessionId[] => {
    const live: SessionId[] = []
    let sessions
    let workspaces: readonly WorkspaceView[] = []
    try {
      sessions = ctx.sessions.list.getSnapshot()
      workspaces = ctx.workspaces.list.getSnapshot().items ?? []
    } catch {
      return live
    }
    for (const id of [...orphanSessions]) {
      const row = sessions.byId[id]
      if (row === undefined || row.blank !== true || workspaceOfSession(workspaces, id) !== undefined) {
        orphanSessions.delete(id)
        continue
      }
      live.push(id)
    }
    return live
  }

  const hasWorkspace = (sessionId: SessionId): boolean => {
    try {
      return workspaceOfSession(ctx.workspaces.list.getSnapshot().items ?? [], sessionId) !== undefined
    } catch {
      return true
    }
  }

  const startProjectlessSession = async (): Promise<SessionId> => {
    const receipt = await createProjectlessSession({
      sessions: ctx.sessions as never,
      openSession: sessionId => { ui.openSession(sessionId) },
      provisionDirectory: () => requestProjectlessDirectory(rpc),
      listSessions: () => {
        const snapshot = ctx.sessions.list.getSnapshot()
        return {
          ids: snapshot.ids ?? [],
          isBlank: (id: SessionId) => snapshot.byId[id]?.blank,
          cwdOf: (id: SessionId) => snapshot.byId[id]?.cwd,
          updatedAt: (id: SessionId) => snapshot.byId[id]?.updatedAt,
        }
      },
      hasWorkspace,
      // Only Sessions this page started count as reusable — see the doc comment
      // on `ProjectlessSessionDeps.isReusable`.
      isReusable: (sessionId) => orphanSessions.has(sessionId),
      currentSessionId: () => currentSessionId(ctx),
    })
    orphanSessions.add(receipt.sessionId)
    report(ctx, {
      phase: 'created',
      sessionId: receipt.sessionId,
      cwd: receipt.cwd,
      reused: receipt.reused,
      orphans: orphanSessions.size,
    })
    return receipt.sessionId
  }

  // A steady self-report runs in every mode, so a bisection step is observable
  // from outside the page without anyone having to look at the screen.
  report(ctx, { phase: 'probe-attached', build: BUILD, ui: ENABLE_UI, order: ENABLE_ORDER, session: ENABLE_SESSION })
  window.setTimeout(() => { void selfCheck(ctx, 'probe', gate) }, 3000)
  const ticker = window.setInterval(() => { void selfCheck(ctx, 'tick', gate) }, 8000)
  ctx.effect(() => () => { window.clearInterval(ticker) }, `${PACKAGE_ID}: probe ticker`)
  if (PROBE_ONLY) return
  if (!ENABLE_UI && !ENABLE_ORDER && !ENABLE_SESSION) return

  ctx.effect(installPickerCss, `${PACKAGE_ID}: picker styles`)
  if (ENABLE_UI) installSidebarStyles(ctx, PACKAGE_ID)
  ctx.effect(
    () => ctx.locale.register(PROJECTLESS_LOCALE_NS, projectlessLocales),
    `${PACKAGE_ID}: dictionaries`,
  )
  if (ENABLE_ORDER) keepRecencyOrder(ctx, PACKAGE_ID, ENABLE_ORDER_WRITE)
  if (ENABLE_SESSION) installDefaultNewSession(ctx, PACKAGE_ID, startProjectlessSession, () => gate.registered)
  if (ENABLE_SESSION) installComposerGate(ctx, PACKAGE_ID, {
    liveOrphans,
    currentSessionId: () => currentSessionId(ctx),
    cwdOf: (sessionId) => {
      try {
        return ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd
      } catch {
        return undefined
      }
    },
    hasWorkspace: (sessionId) => {
      try {
        return workspaceOfSession(ctx.workspaces.list.getSnapshot().items ?? [], sessionId) !== undefined
      } catch {
        return true
      }
    },
  }, gate)

  if (ENABLE_UI) {
    const directoryFlow: HostObservable<boolean> = {
      getSnapshot: () => ctx.slots.entries(DIRECTORY_FLOW).length > 0,
      subscribe: (listener: () => void) => ctx.slots.subscribe(DIRECTORY_FLOW, listener),
    }

    const actions = (): PickerActions => ({
      createWorkspace: input => ctx.workspaces.create(input),
      hooks: { directoryFlow },
      createProjectlessSession: startProjectlessSession,
    })

    ctx.slots.inject('conversation.hero.workspace', () => ctx.slots.register(
      {
        name: 'conversation.hero.workspace',
        priority: -1,
        children: {
          [DIRECTORY_FLOW]: { kind: 'single', scope: 'root' },
        },
        inject: actions,
        locale: PROJECTLESS_LOCALE_NS,
      },
      ProjectlessWorkspacePicker,
    ))
    ctx.slots.inject(DIRECTORY_FLOW, () => mirrorDirectoryFlow(ctx.slots))
  }

  // The Host answers each report with any queued command; `projectless-selftest`
  // is the only one, and it costs a real Session round trip, so it never runs
  // unless somebody asked for it from outside the page.
  window.setTimeout(() => {
    void selfCheck(ctx, 'applied', gate).then((reply) => {
      if (!FORCE_SELFTEST && !(reply?.commands ?? []).includes('projectless-selftest')) return
      void runProjectlessSelftest(ctx, {
        startProjectlessSession,
        openSession: sessionId => { ui.openSession(sessionId) },
        currentSessionId: () => currentSessionId(ctx),
        cwdOf: (sessionId) => {
          try {
            return ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd
          } catch {
            return undefined
          }
        },
        hasWorkspace: (sessionId) => {
          try {
            return workspaceOfSession(ctx.workspaces.list.getSnapshot().items ?? [], sessionId) !== undefined
          } catch {
            return true
          }
        },
        blank: (sessionId) => {
          try {
            return ctx.sessions.list.getSnapshot().byId[sessionId]?.blank
          } catch {
            return undefined
          }
        },
        root: projectlessRoot,
      })
    })
  }, 2500)
}
