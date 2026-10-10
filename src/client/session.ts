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

export interface ProjectlessSessionDeps {
  /** `ctx.sessions.create` — the Host-side Session factory. */
  sessions: SessionCreateFace
  /** Navigate the main view to a Session. */
  openSession(sessionId: SessionId): void
  /** Ask the plugin Host half for the Session's own working directory. */
  provisionDirectory(): Promise<string>
}

export interface ProjectlessSessionReceipt {
  sessionId: SessionId
  cwd: string
}

/**
 * Start a Session that belongs to **no Workspace at all**.
 *
 * DSH's own "new Session" can only ever land inside a Workspace: with nothing
 * to fall back to it clears the main view instead of creating anything
 * (`uiWorkspace.startSession`). The Session factory underneath is not that
 * narrow — `sessions.create` takes an optional `workspaceId`, an optional
 * `cwd`, and an optional preallocated id — so passing only `cwd` yields a
 * Session that is never registered against a Workspace and therefore shows up
 * under **Ungrouped** straight away. Nothing is created and then torn down.
 *
 * A Session with a `cwd` also has what the Host needs to route a prompt; what
 * it lacks is a composer, because DSH disables the blank-Session input bar
 * whenever the Session has no Workspace to name. That one gate is reopened by
 * `installComposerGate` — see `composer.ts`.
 */
export async function createProjectlessSession(deps: ProjectlessSessionDeps): Promise<ProjectlessSessionReceipt> {
  const cwd = await deps.provisionDirectory()
  const sessionId = await deps.sessions.create({ cwd })
  deps.openSession(sessionId)
  return { sessionId, cwd }
}

/** The Workspace a Session is registered against, if any. */
export function workspaceOfSession(
  workspaces: readonly Pick<WorkspaceView, 'workspaceId' | 'sessionIds'>[],
  sessionId: SessionId,
): WorkspaceId | undefined {
  return workspaces.find(workspace => workspace.sessionIds.includes(sessionId))?.workspaceId
}
