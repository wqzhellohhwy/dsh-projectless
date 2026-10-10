/**
 * Wire address of the Host half. DSH 0.2's `connection.rpc.handle` resolves
 * `webServer` from the Connection plugin's own fiber, so third-party channels
 * cannot mount; the endpoints ride the already-authenticated shared `/api`
 * channel as exact Fetch routes instead.
 */
export const PROJECTLESS_RPC_CHANNEL = '/api'
export const PROJECTLESS_RPC_PREFIX = 'projectless'
export const PROJECTLESS_ENDPOINTS = ['create-directory', 'get-root', 'remove-directory'] as const
export type ProjectlessEndpoint = typeof PROJECTLESS_ENDPOINTS[number]

/** Diagnostics endpoint: an opt-out JSONL trace of what the Client face did. */
export const DIAGNOSTICS_ENDPOINT = 'diagnostics'

/** Channel-relative endpoint passed to `ClientConnectionRpc.call`. */
export function projectlessEndpoint(endpoint: ProjectlessEndpoint): string {
  return `${PROJECTLESS_RPC_PREFIX}/${endpoint}`
}

/** Channel-relative diagnostics endpoint. */
export function diagnosticsEndpoint(): string {
  return `${PROJECTLESS_RPC_PREFIX}/${DIAGNOSTICS_ENDPOINT}`
}
