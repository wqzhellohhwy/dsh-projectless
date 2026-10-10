import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import { isManagedSessionPath, isProjectlessPath } from '../shared/paths.ts'
import { PROJECTLESS_RPC_CHANNEL, projectlessEndpoint } from '../shared/rpc.ts'

export { isProjectlessPath }

/**
 * Public DSH faces required to turn a directory into an ungrouped Session:
 * Workspace registration from `ctx.workspaces`, blank-Session connection, and
 * navigation/archival from `ctx.uiWorkspace`.
 */
export interface ProjectlessSessionHost {
  create(input: { path: string }): Promise<WorkspaceView>
  connectWorkspace(workspaceId: WorkspaceId): Promise<SessionId>
  delete(workspaceId: WorkspaceId): Promise<void>
  archiveSession(sessionId: SessionId): Promise<void>
}

/** Reference source DSH's main Conversation view retains its Session under. */
export const MAIN_VIEW_SOURCE = 'mainView'

export interface SessionRowSlice {
  blank: boolean
  retainedBy?: Readonly<Partial<Record<string, number>>> | undefined
}

export interface SessionListSlice {
  byId: Partial<Record<SessionId, SessionRowSlice>>
}

export interface SessionNavigator {
  open(sessionId: SessionId): void
  list: {
    getSnapshot(): SessionListSlice
    subscribe(listener: () => void): () => void
  }
}

export interface WorkspaceListSlice {
  items: readonly WorkspaceView[]
  phase?: 'pending' | 'ready' | undefined
}

/** DSH 0.2 has no `current` field; the main view holds a `mainView` reference instead. */
export function isCurrentSession(sessions: SessionListSlice, sessionId: SessionId): boolean {
  return (sessions.byId[sessionId]?.retainedBy?.[MAIN_VIEW_SOURCE] ?? 0) > 0
}

export interface WorkspaceNavigator {
  list: {
    getSnapshot(): WorkspaceListSlice
    subscribe(listener: () => void): () => void
  }
}

export interface ProjectlessSessionReceipt {
  sessionId: SessionId
  workspaceId: WorkspaceId
  path: string
}

export interface UnusedProjectlessWorkspace {
  workspaceId: WorkspaceId
  path: string
  sessionIds: readonly SessionId[]
}

/** Prevents the startup sweep and the per-new-session reclaim from both tearing down one Workspace. */
export interface AbandonClaim {
  tryClaim(workspaceId: WorkspaceId): boolean
}

export function createAbandonClaim(): AbandonClaim {
  const claimed = new Set<WorkspaceId>()
  return {
    tryClaim(workspaceId) {
      if (claimed.has(workspaceId)) return false
      claimed.add(workspaceId)
      return true
    },
  }
}

/** Menu entry id for the projectless action; also its selected-state key. */
export const PROJECTLESS_ENTRY_ID = '::projectless-session'

/** Workspaces this page provisioned, authoritative over the path heuristic. */
export interface ProjectlessRegistry {
  remember(workspaceId: WorkspaceId): void
  has(workspaceId: WorkspaceId): boolean
  ids(): WorkspaceId[]
}

export function createProjectlessRegistry(): ProjectlessRegistry {
  const ids = new Set<WorkspaceId>()
  return {
    remember(workspaceId) { ids.add(workspaceId) },
    has(workspaceId) { return ids.has(workspaceId) },
    ids() { return [...ids] },
  }
}

export interface PickerSelection<T> {
  /** Rows a user may meaningfully pick as a project. */
  projects: readonly T[]
  /** Value handed to the Menu: the projectless entry wins when it is active. */
  selectedId: string | undefined
  projectlessActive: boolean
}

/**
 * Hide temporary scratch workspaces from the picker and move the selected
 * state onto the projectless entry, so the active projectless session reads as
 * "Session without workspace" instead of exposing its generated directory.
 */
export function resolvePickerSelection<T extends { workspaceId: WorkspaceId }>(
  items: readonly T[],
  selectedId: WorkspaceId | undefined,
  isProjectless: (row: T) => boolean,
): PickerSelection<T> {
  const projects: T[] = []
  let projectlessActive = false
  for (const row of items) {
    if (isProjectless(row)) {
      if (selectedId !== undefined && row.workspaceId === selectedId) projectlessActive = true
      continue
    }
    projects.push(row)
  }
  return {
    projects,
    selectedId: projectlessActive ? PROJECTLESS_ENTRY_ID : selectedId,
    projectlessActive,
  }
}

function rpcValue(result: { ok: boolean, value?: unknown, error?: { message: string } }, label: string): unknown {
  if (!result.ok) throw new Error(result.error?.message ?? `${label} failed`)
  return result.value
}

function expectPathObject(value: unknown, key: 'path' | 'root', label: string): string {
  if (typeof value !== 'object' || value === null || typeof (value as Record<string, unknown>)[key] !== 'string') {
    throw new Error(`${label} returned an invalid directory response`)
  }
  return (value as Record<typeof key, string>)[key]
}

/** Call the plugin Host half and validate its intentionally tiny response. */
export async function requestProjectlessDirectory(rpc: ClientConnectionRpc): Promise<string> {
  return expectPathObject(
    rpcValue(await rpc.call(PROJECTLESS_RPC_CHANNEL, projectlessEndpoint('create-directory'), {}), 'projectless session Host'),
    'path',
    'projectless session Host',
  )
}

export async function requestProjectlessRoot(rpc: ClientConnectionRpc): Promise<string> {
  return expectPathObject(
    rpcValue(await rpc.call(PROJECTLESS_RPC_CHANNEL, projectlessEndpoint('get-root'), {}), 'projectless session Host'),
    'root',
    'projectless session Host',
  )
}

export async function requestRemoveProjectlessDirectory(rpc: ClientConnectionRpc, path: string): Promise<void> {
  rpcValue(await rpc.call(PROJECTLESS_RPC_CHANNEL, projectlessEndpoint('remove-directory'), { path }), 'projectless session Host')
}

/**
 * Create and open a Session while retaining its temporary Workspace long
 * enough for DSH's native blank-session composer to accept the first prompt.
 */
export async function createAndOpenProjectlessSession(
  workspaces: ProjectlessSessionHost,
  sessions: SessionNavigator,
  provisionDirectory: () => Promise<string>,
  registry?: Pick<ProjectlessRegistry, 'remember'>,
  removeDirectory: (path: string) => Promise<void> = async () => {},
  pending?: Set<WorkspaceId>,
): Promise<ProjectlessSessionReceipt> {
  const path = await provisionDirectory()
  const workspace = await workspaces.create({ path })
  registry?.remember(workspace.workspaceId)
  pending?.add(workspace.workspaceId)
  try {
    const sessionId = await workspaces.connectWorkspace(workspace.workspaceId)
    sessions.open(sessionId)
    return { sessionId, workspaceId: workspace.workspaceId, path }
  } catch (reason) {
    pending?.delete(workspace.workspaceId)
    // A failed Session creation must not leave a temporary Workspace behind.
    await workspaces.delete(workspace.workspaceId).catch(() => {})
    await removeDirectory(path).catch(() => {})
    throw reason
  }
}

/** Unregister a scratch Workspace and archive the unused Session it held. */
export async function abandonUnusedProjectlessWorkspace(
  workspaces: Pick<ProjectlessSessionHost, 'delete' | 'archiveSession'>,
  target: UnusedProjectlessWorkspace,
  removeDirectory: (path: string) => Promise<void>,
  onError: (reason: unknown) => void = console.error,
): Promise<void> {
  for (const sessionId of target.sessionIds) {
    await workspaces.archiveSession(sessionId).catch(onError)
  }
  await workspaces.delete(target.workspaceId).catch(onError)
  await removeDirectory(target.path).catch(onError)
}

/**
 * A scratch Workspace is reclaimable when every Session it accounts for is
 * still blank and none of them is the one on screen.
 *
 * `temporaryLabel` narrows the test to Workspaces this plugin named itself,
 * which is what separates a leftover of a previous DSH run from a Workspace the
 * user created pointing at a directory that happens to have the same shape.
 */
export function isUnusedProjectlessWorkspace(
  workspace: Pick<WorkspaceView, 'workspaceId' | 'path' | 'title' | 'sessionIds'>,
  sessions: SessionListSlice,
  root: string,
  skip: ReadonlySet<WorkspaceId> = new Set(),
  temporaryLabel?: string | undefined,
): boolean {
  if (skip.has(workspace.workspaceId) || !isManagedSessionPath(workspace.path, root)) return false
  if (temporaryLabel !== undefined && workspace.title !== temporaryLabel) return false
  // A just-created Workspace has no sessions yet. Sweeping that empty row
  // races create→connectWorkspace and surfaces workspace-not-found.
  if (workspace.sessionIds.length === 0) return false
  for (const sessionId of workspace.sessionIds) {
    if (isCurrentSession(sessions, sessionId)) return false
    const row = sessions.byId[sessionId]
    if (row === undefined || row.blank !== true) return false
  }
  return true
}

function findUnusedProjectlessWorkspaces(
  workspaces: readonly Pick<WorkspaceView, 'workspaceId' | 'path' | 'title' | 'sessionIds'>[],
  sessions: SessionListSlice,
  root: string,
  skip: ReadonlySet<WorkspaceId>,
  temporaryLabel?: string | undefined,
): UnusedProjectlessWorkspace[] {
  return workspaces
    .filter(workspace => isUnusedProjectlessWorkspace(workspace, sessions, root, skip, temporaryLabel))
    .map(workspace => ({
      workspaceId: workspace.workspaceId,
      path: workspace.path,
      sessionIds: workspace.sessionIds,
    }))
}

/**
 * Keep the temporary Workspace registered until DSH accepts the first prompt,
 * then unregister it so the Session settles into Ungrouped.
 *
 * Leaving the blank Session no longer tears anything down. It used to: the
 * Workspace, the Session and its directory were all reclaimed the moment the
 * user clicked another Session, which also threw away the text typed into the
 * composer — DSH keeps that draft (and only that draft) under
 * `dsh.conversation.<sessionId>`, so archiving the Session is what made an
 * unsent message disappear. A blank Session therefore stays exactly where the
 * user left it, and is reclaimed only when a *new* projectless Session is
 * started (see `reclaimUnusedProjectlessWorkspaces`) or by the startup sweep.
 */
export function watchTemporaryWorkspace(
  workspaces: Pick<ProjectlessSessionHost, 'delete'>,
  sessions: SessionNavigator,
  receipt: ProjectlessSessionReceipt,
  onError: (reason: unknown) => void = console.error,
): () => void {
  let active = true
  let unsubscribe = (): void => {}
  const reconcile = (): void => {
    if (!active || sessions.list.getSnapshot().byId[receipt.sessionId]?.blank !== false) return
    active = false
    unsubscribe()
    void workspaces.delete(receipt.workspaceId).catch(onError)
  }
  unsubscribe = sessions.list.subscribe(reconcile)
  reconcile()
  return () => {
    // Disposal must not discard a draft either: an unloaded plugin leaves its
    // blank Workspace for the next startup sweep instead of deleting the text.
    active = false
    unsubscribe()
  }
}

/**
 * Reclaim the blank projectless Workspaces this page created earlier.
 *
 * Called right after a *new* projectless Session is opened, so the sidebar
 * keeps a single "Session without workspace" group: the one the user just
 * asked for. Only Workspaces this page provisioned (the registry) are
 * eligible, so a Workspace the user added by hand is never touched.
 */
export function reclaimUnusedProjectlessWorkspaces(
  workspaces: Pick<ProjectlessSessionHost, 'delete' | 'archiveSession'> & WorkspaceNavigator,
  sessions: SessionNavigator,
  root: string,
  removeDirectory: (path: string) => Promise<void>,
  registry: ProjectlessRegistry,
  pending: ReadonlySet<WorkspaceId>,
  claim: AbandonClaim,
  onError: (reason: unknown) => void = console.error,
): void {
  const owned = new Set<WorkspaceId>(registry.ids())
  if (owned.size === 0) return
  const state = workspaces.list.getSnapshot()
  if (state.phase === 'pending') return
  for (const unused of findUnusedProjectlessWorkspaces(
    state.items,
    sessions.list.getSnapshot(),
    root,
    pending,
  )) {
    if (!owned.has(unused.workspaceId)) continue
    if (!claim.tryClaim(unused.workspaceId)) continue
    void abandonUnusedProjectlessWorkspace(workspaces, unused, removeDirectory, onError)
  }
}

/**
 * Remove scratch Workspaces left behind by a previous DSH run.
 *
 * This is what keeps the retention policy bounded: a blank Session survives
 * the click that leaves it (so its draft survives too) but not a restart.
 * Only Workspaces this plugin named itself are eligible, and every Workspace
 * this page created is skipped, so a running page never reclaims its own.
 */
export function sweepLeftoverProjectlessWorkspaces(
  workspaces: Pick<ProjectlessSessionHost, 'delete' | 'archiveSession'> & WorkspaceNavigator,
  sessions: SessionNavigator,
  root: string,
  removeDirectory: (path: string) => Promise<void>,
  registry: ProjectlessRegistry,
  pending: ReadonlySet<WorkspaceId>,
  claim: AbandonClaim,
  temporaryLabel: string | undefined,
  onError: (reason: unknown) => void = console.error,
): () => void {
  let active = true
  const reconcile = (): void => {
    if (!active) return
    const workspaceState = workspaces.list.getSnapshot()
    if (workspaceState.phase === 'pending') return
    const skip = new Set<WorkspaceId>([...registry.ids(), ...pending])
    for (const leftover of findUnusedProjectlessWorkspaces(
      workspaceState.items,
      sessions.list.getSnapshot(),
      root,
      skip,
      temporaryLabel,
    )) {
      if (!claim.tryClaim(leftover.workspaceId)) continue
      void abandonUnusedProjectlessWorkspace(workspaces, leftover, removeDirectory, onError)
    }
  }
  const unsubscribeWorkspaces = workspaces.list.subscribe(reconcile)
  const unsubscribeSessions = sessions.list.subscribe(reconcile)
  reconcile()
  return () => {
    active = false
    unsubscribeWorkspaces()
    unsubscribeSessions()
  }
}
