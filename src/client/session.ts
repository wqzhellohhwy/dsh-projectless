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
}

export interface ProjectlessSessionDeps {
  /** `ctx.sessions.create` — the Host-side Session factory. */
  sessions: SessionCreateFace
  /** Navigate the main view to a Session. */
  openSession(sessionId: SessionId): void
  /** Ask the Host half to ensure the shared "Ungrouped" directory and return it. */
  ensureGroupDirectory(): Promise<string>
  /** Current Session list, used to reuse the blank projectless Session. */
  listSessions(): SessionListFace
  /** Whether a Session is registered against a Workspace. */
  hasWorkspace(sessionId: SessionId): boolean
}

export interface ProjectlessSessionReceipt {
  sessionId: SessionId
  cwd: string
  /** True when an existing blank projectless Session was reopened, not created. */
  reused: boolean
}

/**
 * Open the projectless Session — reusing it if it is already there.
 *
 * The whole point is *when* things get created. A "new Session" is not a new
 * Session: DSH keeps at most one blank Session per destination and an
 * unsent draft lives on the Session, so creating a fresh one on every click
 * both churns working directories and throws the typed text away. So:
 *
 * - the working directory is **shared and stable** (`ROOT/<label>`, where the
 *   label is DSH's own word for the plain-Session bucket), created once;
 * - if a blank Session already sits on that directory and belongs to no
 *   Workspace, it is **reopened as-is** — same Session, same draft;
 * - otherwise exactly one Session is created on that directory.
 *
 * The Session still belongs to **no Workspace**, so it lands under Ungrouped,
 * and its `cwd` is what lets the Host route a prompt. DSH disables the blank
 * composer for a Session with no Workspace to name; that gate is reopened by
 * `installComposerGate` (see `composer.ts`), and the stable directory name is
 * what the hero's workspace chip displays.
 */
export async function createProjectlessSession(deps: ProjectlessSessionDeps): Promise<ProjectlessSessionReceipt> {
  const cwd = await deps.ensureGroupDirectory()
  const list = deps.listSessions()
  const reusable = list.ids.find(id => list.isBlank(id) === true
    && list.cwdOf(id) === cwd
    && !deps.hasWorkspace(id))
  if (reusable !== undefined) {
    deps.openSession(reusable)
    return { sessionId: reusable, cwd, reused: true }
  }
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
