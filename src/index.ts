import { appendFile, readFile } from 'node:fs/promises'
import { detectPatchStatus } from './host/patches.ts'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import {
  createProjectlessDirectory,
  ensureGroupDirectory,
  removeUnusedProjectlessDirectory,
  resolveProjectlessRoot,
} from './host/directories.ts'
import {
  PROJECTLESS_ENDPOINTS,
  PROJECTLESS_RPC_CHANNEL,
  diagnosticsEndpoint,
  projectlessEndpoint,
  type ProjectlessEndpoint,
} from './shared/rpc.ts'

/** Host half: authenticated DSH endpoints for filesystem provisioning. */
export const name = 'dsh-projectless'
export const inject = ['connection']

export interface Config {
  /** Absolute parent for date folders; defaults to ~/Documents/DSH. */
  root?: string
  /**
   * Append the Client face's self-report to a JSONL file. It exists so that
   * "the plugin is installed but nothing happens" can be told apart from a
   * stale page, a missing sidebar store, or a wrapper that was replaced.
   * Defaults to enabled; set `false` to switch it off.
   */
  diagnostics?: boolean
  /** Override the diagnostics file; defaults to `%TEMP%/dsh-projectless-diagnostics.json`. */
  diagnosticsFile?: string
  /**
   * Inspect the application archive for the two DSH-side patches on every Host
   * start and record the result in the diagnostics log. Defaults to enabled;
   * set `false` to skip the (one-off, ~100 MB) read.
   */
  patchCheck?: boolean
  /**
   * Override the command file the Client face reads back on each report.
   * Writing `{ "commands": ["draft-selftest"] }` there makes the next page
   * load run one scripted new-session → draft → switch-away → switch-back
   * round trip and report what survived; with no file, nothing runs.
   */
  commandsFile?: string
}

type RpcResult =
  | { ok: true, value: unknown }
  | { ok: false, error: { code: string, message: string, details: Record<string, unknown> } }

function pathPayload(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined
  const path = (payload as { path?: unknown }).path
  return typeof path === 'string' ? path : undefined
}

function namePayload(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined
  const name = (payload as { name?: unknown }).name
  return typeof name === 'string' ? name : undefined
}

function badRequest(message: string): RpcResult {
  return {
    ok: false,
    error: {
      code: 'bad-request',
      message,
      details: { issues: [] },
    },
  }
}

function internalError(message: string): RpcResult {
  return {
    ok: false,
    error: {
      code: 'internal',
      message,
      details: {},
    },
  }
}

/** Run one decoded endpoint against the configured root. */
export async function dispatchProjectlessEndpoint(
  root: string,
  endpoint: ProjectlessEndpoint,
  payload: unknown,
): Promise<RpcResult> {
  try {
    if (endpoint === 'create-directory') {
      return { ok: true, value: { path: await createProjectlessDirectory(root) } }
    }
    if (endpoint === 'get-root') {
      return { ok: true, value: { root: await resolveProjectlessRoot(root) } }
    }
    if (endpoint === 'ensure-group-directory') {
      const name = namePayload(payload)
      if (name === undefined) return badRequest('ensure-group-directory requires { name }')
      return { ok: true, value: { path: await ensureGroupDirectory(root, name) } }
    }
    const path = pathPayload(payload)
    if (path === undefined) return badRequest('remove-directory requires { path }')
    return { ok: true, value: { result: await removeUnusedProjectlessDirectory(root, path) } }
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : String(reason)
    if (message.includes('absolute path') || message.includes('not a projectless')) {
      return badRequest(message)
    }
    return internalError(message)
  }
}

function envelope(rpcId: string, result: RpcResult): Response {
  return Response.json({ type: 'server-response', rpcId, result })
}

type DecodedRequest = { rpcId: string, payload: unknown }

/**
 * Decode Connection's `client-request` envelope for one exact endpoint, so the
 * browser half keeps using `ctx.connection.rpc.call`.
 */
async function decodeRequest(request: Request, method: string): Promise<DecodedRequest | Response> {
  if (request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
    return new Response('content type must be application/json', { status: 415 })
  }
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return new Response('body is not JSON', { status: 400 })
  }
  const message = body as { type?: unknown, rpcId?: unknown, method?: unknown, payload?: unknown } | null
  if (typeof message !== 'object' || message === null || message.type !== 'client-request' || typeof message.rpcId !== 'string') {
    return new Response('invalid client-request envelope', { status: 400 })
  }
  if (message.method !== method) {
    return envelope(message.rpcId, badRequest(`method ${JSON.stringify(message.method)} does not match endpoint ${JSON.stringify(method)}`))
  }
  return { rpcId: message.rpcId, payload: message.payload }
}

/** One exact Fetch route answering a single decoded endpoint. */
export function createProjectlessFetch(root: string, endpoint: ProjectlessEndpoint) {
  const method = projectlessEndpoint(endpoint)
  return async (request: Request): Promise<Response> => {
    const decoded = await decodeRequest(request, method)
    if (decoded instanceof Response) return decoded
    return envelope(decoded.rpcId, await dispatchProjectlessEndpoint(root, endpoint, decoded.payload))
  }
}

/** Read the pending Client-face commands; a missing or broken file means none. */
export async function readCommands(file: string): Promise<string[]> {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as { commands?: unknown }
    const commands = parsed?.commands
    return Array.isArray(commands) ? commands.filter((value): value is string => typeof value === 'string') : []
  } catch {
    return []
  }
}

/**
 * Append one Client-face self-report and hand back any queued command.
 * Failures never disturb the page.
 */
export function createDiagnosticsFetch(file: string, commandsFile: string) {
  const method = diagnosticsEndpoint()
  return async (request: Request): Promise<Response> => {
    const decoded = await decodeRequest(request, method)
    if (decoded instanceof Response) return decoded
    try {
      const line = JSON.stringify({ receivedAt: new Date().toISOString(), payload: decoded.payload })
      await appendFile(file, `${line}\n`, 'utf8')
    } catch {
      // A missing directory or a locked file must not break the Client face.
    }
    return envelope(decoded.rpcId, { ok: true, value: { written: true, commands: await readCommands(commandsFile) } })
  }
}

/** Register the least-privilege endpoints used by the browser half. */
export function apply(ctx: Context, config: Config = {}): void {
  const root = config.root ?? join(homedir(), 'Documents', 'DSH')
  for (const endpoint of PROJECTLESS_ENDPOINTS) {
    const path = `${PROJECTLESS_RPC_CHANNEL}/${projectlessEndpoint(endpoint)}`
    ctx.effect(() => ctx.connection.fetch.register({
      path,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: createProjectlessFetch(root, endpoint),
    }), `${name}: ${path}`)
  }
  if (config.diagnostics === false) return
  const file = config.diagnosticsFile ?? join(tmpdir(), 'dsh-projectless-diagnostics.json')
  const commandsFile = config.commandsFile ?? join(tmpdir(), 'dsh-projectless-commands.json')
  // Patch self-check, written once per Host start: the two DSH-side patches live
  // in the application archive, so "composer still inert" and "patch missing"
  // are indistinguishable from the UI alone.
  if (config.patchCheck !== false) {
    ctx.effect(() => {
      void detectPatchStatus().then((status) => {
        const line = JSON.stringify({
          receivedAt: new Date().toISOString(),
          payload: { phase: 'patch-check', plugin: name, ...status },
        })
        return appendFile(file, `${line}\n`, 'utf8').then(() => {
          if (!status.composerGate || !status.composerChip) console.warn(`${name}: ${status.summary}`)
        })
      }).catch(() => {})
      return () => {}
    }, `${name}: patch self-check`)
  }
  const path = `${PROJECTLESS_RPC_CHANNEL}/${diagnosticsEndpoint()}`
  ctx.effect(() => ctx.connection.fetch.register({
    path,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: createDiagnosticsFetch(file, commandsFile),
  }), `${name}: ${path}`)
}
