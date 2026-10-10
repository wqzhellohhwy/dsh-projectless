import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import { PROJECTLESS_RPC_CHANNEL, projectlessEndpoint } from '../shared/rpc.ts'

/** Menu entry id for the projectless action; only a picker row, never a Session identity. */
export const PROJECTLESS_ENTRY_ID = '::projectless-session'

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

/** Call the plugin Host half for a fresh scratch directory. */
export async function requestProjectlessDirectory(rpc: ClientConnectionRpc): Promise<string> {
  return expectPathObject(
    rpcValue(await rpc.call(PROJECTLESS_RPC_CHANNEL, projectlessEndpoint('create-directory'), {}), 'projectless Host'),
    'path',
    'projectless Host',
  )
}

/** Ensure the shared "Ungrouped" directory exists on the Host and return its path. */
export async function requestGroupDirectory(rpc: ClientConnectionRpc, name: string): Promise<string> {
  return expectPathObject(
    rpcValue(await rpc.call(PROJECTLESS_RPC_CHANNEL, projectlessEndpoint('ensure-group-directory'), { name }), 'projectless Host'),
    'path',
    'projectless Host',
  )
}

export async function requestProjectlessRoot(rpc: ClientConnectionRpc): Promise<string> {
  return expectPathObject(
    rpcValue(await rpc.call(PROJECTLESS_RPC_CHANNEL, projectlessEndpoint('get-root'), {}), 'projectless Host'),
    'root',
    'projectless Host',
  )
}

/** DSH's own Session creation face: `workspaceId`, `cwd` and `sessionId` are all optional. */
export interface SessionCreateFace {
  create(opts?: { workspaceId?: WorkspaceId, cwd?: string, sessionId?: SessionId }): Promise<SessionId>
}

/** A read-only view of the current Session list, enough to find a reusable one. */
export interface SessionListFace {
  ids: readonly SessionId[]
  isBlank(sessionId: SessionId): boolean | undefined
  cwdOf(sessionId: SessionId): string | undefined
  updatedAt(sessionId: SessionId): number | undefined
}

export interface ProjectlessSessionDeps {
  /** `ctx.sessions.create` — the Host-side Session factory. */
  sessions: SessionCreateFace
  /** Navigate the main view to a Session. */
  openSession(sessionId: SessionId): void
  /** Provision the working directory for one *new* Session (one per Session). */
  provisionDirectory(): Promise<string>
  /** Current Session list, used to find a blank projectless Session to reuse. */
  listSessions(): SessionListFace
  /** Whether a Session is registered against a Workspace. */
  hasWorkspace(sessionId: SessionId): boolean
  /**
   * Whether a Session is a blank projectless one **this page** started.
   *
   * Deliberately narrow. "Reuse the blank projectless Session" must not reach
   * back into history: an old blank Session from a previous run is not the
   * conversation the user is starting now, and reopening it would silently
   * give the new conversation somebody else's directory. Only a Session this
   * page created — i.e. one the user just opened and has not sent to yet —
   * counts.
   */
  isReusable(sessionId: SessionId): boolean
  /** The Session the main view currently retains, if any. */
  currentSessionId(): SessionId | undefined
}

export interface ProjectlessSessionReceipt {
  sessionId: SessionId
  cwd: string
  /** True when an existing blank projectless Session was reopened, not created. */
  reused: boolean
}

/**
 * Open a projectless Session — reusing an unused one if there is one.
 *
 * Two things have to hold at once, and they pull in opposite directions:
 *
 * 1. **Every conversation gets its own working directory.** Sharing one
 *    directory across Sessions would mean every projectless conversation reads
 *    and writes the same files, which is not what "no workspace" should mean.
 * 2. **Clicking "new Session" must not churn.** Creating a Session (and a
 *    directory) on every click both litters the filesystem and throws away the
 *    text typed into the previous blank Session — DSH keeps the unsent draft on
 *    the Session, and the Session is only "reusable" while it is blank.
 *
 * So the clock only starts when it has to: a *blank* projectless Session is
 * reused, and a directory is provisioned only when there is none to reuse —
 * which, in practice, means after the previous conversation actually started.
 */
export async function createProjectlessSession(deps: ProjectlessSessionDeps): Promise<ProjectlessSessionReceipt> {
  const list = deps.listSessions()
  const current = deps.currentSessionId()
  const reusable = list.ids.filter(id => deps.isReusable(id)
    && list.isBlank(id) === true
    && !deps.hasWorkspace(id)
    && list.cwdOf(id) !== undefined)
  // Prefer the Session already on screen (then "new Session" is a no-op rather
  // than a jump), otherwise the most recently touched blank one.
  const pick = current !== undefined && reusable.includes(current)
    ? current
    : reusable.slice().sort((a, b) => (list.updatedAt(b) ?? 0) - (list.updatedAt(a) ?? 0))[0]
  if (pick !== undefined) {
    deps.openSession(pick)
    return { sessionId: pick, cwd: list.cwdOf(pick) ?? '', reused: true }
  }
  const cwd = await deps.provisionDirectory()
  const sessionId = await deps.sessions.create({ cwd })
  deps.openSession(sessionId)
  return { sessionId, cwd, reused: false }
}

/** The Workspace a Session is registered against, if any. */
export function workspaceOfSession(
  workspaces: readonly Pick<WorkspaceView, 'workspaceId' | 'sessionIds'>[],
  sessionId: SessionId,
): WorkspaceId | undefined {
  return workspaces.find(workspace => workspace.sessionIds.includes(sessionId))?.workspaceId
}
