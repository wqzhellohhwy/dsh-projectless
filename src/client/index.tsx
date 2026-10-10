import * as React from 'react'
import { useCallback, useEffect, useState } from 'react'
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
  createAbandonClaim,
  createAndOpenProjectlessSession,
  createProjectlessRegistry,
  isProjectlessPath,
  reclaimUnusedProjectlessWorkspaces,
  requestProjectlessDirectory,
  requestProjectlessRoot,
  requestRemoveProjectlessDirectory,
  resolvePickerSelection,
  sweepLeftoverProjectlessWorkspaces,
  watchTemporaryWorkspace,
} from './session.ts'
import { report, type DiagnosticsReply } from './diagnostics.ts'
import { runDraftSelftest } from './selftest.ts'
import { PROJECTLESS_LOCALE_NS, projectlessLocales } from './locales.ts'
import {
  installDefaultNewSession,
  installStyles as installSidebarStyles,
  keepRecencyOrder,
  markTemporaryGroups,
  projectlessLabel,
  reconcileLabel,
  recencyOrders,
  watchTemporaryLabel,
} from './sidebar.ts'

const PACKAGE_ID = 'dsh-projectless'
const VERSION = '1.0.0'
/** Bumped on every build so a stale page is distinguishable from a fresh one. */
const BUILD = 3
/**
 * Run the draft self-test on every page load. Always false in a build that is
 * meant to be used: the self-test opens and closes real Sessions on screen, so
 * it only runs when the Host hands out the `draft-selftest` command. Set it to
 * true for one build when the command channel itself is what needs testing.
 */
const FORCE_DRAFT_SELFTEST = false
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
  isProjectlessWorkspace(workspace: WorkspaceView): boolean
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
  isProjectlessWorkspace,
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

  const selection = resolvePickerSelection(
    workspaceState.items,
    selectedId,
    isProjectlessWorkspace,
  )
  const workspaceItems: MenuEntry[] = selection.projects.map(workspace => ({
    id: workspace.workspaceId,
    label: workspace.title,
    icon: <IconFolderCloseRegular size={16} />,
    disabled: busy,
  }))
  const flowAvailable = useDirectoryFlow((occupied: boolean) => occupied)
  useEffect(() => {
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
        selectedId={selection.selectedId}
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
 * DSH 0.2 split the old combined Workspace face: registrations live on
 * `ctx.workspaces`, blank-Session connection, navigation and archival on
 * `ctx.uiWorkspace`.
 */
function projectlessHost(ctx: Context) {
  const workspaces = ctx.workspaces
  const ui: UiWorkspace = ctx.uiWorkspace
  const sessions = {
    list: ctx.sessions.list,
    open: (sessionId: SessionId) => { ui.openSession(sessionId) },
  }
  const host = {
    list: workspaces.list,
    create: (input: { path: string }) => workspaces.create(input),
    delete: (workspaceId: WorkspaceId) => workspaces.delete(workspaceId),
    rename: (workspaceId: WorkspaceId, title: string) => workspaces.rename(workspaceId, title),
    connectWorkspace: (workspaceId: WorkspaceId) => ui.connectWorkspace(workspaceId),
    archiveSession: (sessionId: SessionId) => ui.archiveSession(sessionId),
  }
  return { host, sessions }
}

/**
 * Post the Client face's own state to the Host: the only way to tell "the
 * plugin never ran", "it ran but the sidebar store was missing" and "it ran
 * and is enforcing the order" apart from outside the page.
 */
async function selfCheck(ctx: Context, phase: string): Promise<DiagnosticsReply | undefined> {
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
  let taggedTemporarySections = -1
  try {
    sidebarSections = document.querySelectorAll('[role="tree"] > div').length
    taggedTemporarySections = document.querySelectorAll('[data-dsh-projectless-temp]').length
  } catch { /* no document yet */ }
  const ui = ctx.uiWorkspace
  let blankCount = 0
  let blankProjectless = 0
  try {
    const sessions = ctx.sessions.list.getSnapshot()
    for (const id of sessions.ids ?? []) {
      if (sessions.byId[id]?.blank !== true) continue
      blankCount += 1
    }
    for (const workspace of ctx.workspaces.list.getSnapshot().items ?? []) {
      if (!isProjectlessPath(workspace.path)) continue
      if (workspace.sessionIds.some(id => sessions.byId[id]?.blank === true)) blankProjectless += 1
    }
  } catch { /* services are going away */ }
  return await report(ctx, {
    phase,
    plugin: `${PACKAGE_ID}@${VERSION}`,
    build: BUILD,
    url: String((typeof location === 'undefined' ? undefined : location.href) ?? ''),
    wrapperInstalled: typeof ui?.startSession === 'function'
      && (ui.startSession as { __dshProjectless?: boolean }).__dshProjectless === true,
    label: projectlessLabel(ctx) ?? null,
    orderBy,
    storedAccounts,
    sidebarSections,
    taggedTemporarySections,
    blankCount,
    blankProjectless,
  })
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
  const { host, sessions } = projectlessHost(ctx)
  const registry = createProjectlessRegistry()
  const pendingWorkspaceIds = new Set<WorkspaceId>()
  const claim = createAbandonClaim()
  const rpc = ctx.connection.rpc as unknown as ClientConnectionRpc
  const removeDirectory = (path: string) => requestRemoveProjectlessDirectory(rpc, path)
  const isProjectlessWorkspace = (workspace: WorkspaceView): boolean => (
    registry.has(workspace.workspaceId) || isProjectlessPath(workspace.path)
  )
  let rootPromise: Promise<string> | undefined
  const projectlessRoot = (): Promise<string> => (rootPromise ??= requestProjectlessRoot(rpc))

  ctx.effect(installPickerCss, `${PACKAGE_ID}: picker styles`)
  ctx.effect(
    () => ctx.locale.register(PROJECTLESS_LOCALE_NS, projectlessLocales),
    `${PACKAGE_ID}: dictionaries`,
  )

  const directoryFlow: HostObservable<boolean> = {
    getSnapshot: () => ctx.slots.entries(DIRECTORY_FLOW).length > 0,
    subscribe: (listener: () => void) => ctx.slots.subscribe(DIRECTORY_FLOW, listener),
  }

  /**
   * Reclaim the blank projectless Workspaces this page created earlier, so the
   * sidebar keeps a single "Session without workspace" group. Deferred, because
   * the Session that was just opened has to be the current one before its
   * predecessor counts as unused.
   */
  const scheduleReclaim = (): void => {
    window.setTimeout(() => {
      void projectlessRoot().then((root) => {
        reclaimUnusedProjectlessWorkspaces(
          host,
          sessions,
          root,
          removeDirectory,
          registry,
          pendingWorkspaceIds,
          claim,
        )
      }).catch(() => {})
    }, 1200)
  }

  const createProjectlessSession = async (): Promise<SessionId> => {
    const label = projectlessLabel(ctx)
    // Start the rename watcher before provisioning: it wins the race against
    // the Workspace list refresh that follows creation.
    const stopLabelWatch = watchTemporaryLabel(ctx, label)
    let receipt
    try {
      receipt = await createAndOpenProjectlessSession(
        host,
        sessions,
        () => requestProjectlessDirectory(rpc),
        registry,
        removeDirectory,
        pendingWorkspaceIds,
      )
    } finally {
      window.setTimeout(stopLabelWatch, 2000)
    }
    if (label !== undefined) await host.rename(receipt.workspaceId, label).catch(() => {})
    ctx.effect(
      () => {
        const stop = watchTemporaryWorkspace(host, sessions, receipt)
        pendingWorkspaceIds.delete(receipt.workspaceId)
        return stop
      },
      `${PACKAGE_ID}: watch ${receipt.sessionId} temporary workspace`,
    )
    reconcileLabel(ctx, receipt.sessionId, label)
    scheduleReclaim()
    return receipt.sessionId
  }

  // A blank Session left behind by a previous DSH run is reclaimed on startup;
  // one the user simply clicked away from is kept, draft and all.
  ctx.effect(() => {
    let disposed = false
    let stopSweep = (): void => {}
    void projectlessRoot().then((root) => {
      if (disposed) return
      stopSweep = sweepLeftoverProjectlessWorkspaces(
        host,
        sessions,
        root,
        removeDirectory,
        registry,
        pendingWorkspaceIds,
        claim,
        projectlessLabel(ctx),
      )
    }).catch(console.error)
    return () => {
      disposed = true
      stopSweep()
    }
  }, `${PACKAGE_ID}: sweep leftover blank workspaces`)

  installSidebarStyles(ctx, PACKAGE_ID)
  markTemporaryGroups(ctx, PACKAGE_ID)
  keepRecencyOrder(ctx, PACKAGE_ID)
  installDefaultNewSession(ctx, PACKAGE_ID, createProjectlessSession)

  const actions = (): PickerActions => ({
    createWorkspace: input => host.create(input),
    isProjectlessWorkspace,
    hooks: { directoryFlow },
    createProjectlessSession,
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

  // The Host answers each report with any queued command; `draft-selftest` is
  // the only one, and it costs a real Session round trip, so it never runs
  // unless somebody asked for it from outside the page.
  window.setTimeout(() => {
    void selfCheck(ctx, 'applied').then((reply) => {
      if (!FORCE_DRAFT_SELFTEST && !(reply?.commands ?? []).includes('draft-selftest')) return
      void runDraftSelftest(ctx, {
        createProjectlessSession,
        openSession: sessionId => { ctx.uiWorkspace.openSession(sessionId) },
        snapshot: () => {
          const sessions = ctx.sessions.list.getSnapshot()
          const current = (sessions.ids ?? []).find((id: string) => (sessions.byId[id]?.retainedBy?.mainView ?? 0) > 0)
          return { current, blank: (id: SessionId) => sessions.byId[id]?.blank }
        },
        hasProjectlessWorkspace: sessionId => (ctx.workspaces.list.getSnapshot().items ?? [])
          .some(workspace => isProjectlessPath(workspace.path) && workspace.sessionIds.includes(sessionId)),
      })
    })
  }, 2500)
}
