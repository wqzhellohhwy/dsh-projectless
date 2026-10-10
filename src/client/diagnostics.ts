import type { Context } from '@deepseek-ai/cordis'
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import { PROJECTLESS_RPC_CHANNEL, diagnosticsEndpoint } from '../shared/rpc.ts'

/** What the Host hands back: the report was written, plus any queued command. */
export interface DiagnosticsReply {
  written?: boolean
  commands?: string[]
}

/**
 * Post the Client face's own state to the Host. Nothing here changes
 * behaviour; it exists so that "the plugin reads as active but the feature does
 * nothing" can be told apart from the outside — a stale page, a sidebar store
 * that never appeared, and a wrapper that got replaced are indistinguishable
 * from the Host otherwise. The Host half writes each report as one JSONL line
 * and can be switched off with `config.diagnostics: false`.
 *
 * @returns the Host's reply, or undefined when diagnostics are unavailable.
 */
export async function report(ctx: Context, payload: Record<string, unknown>): Promise<DiagnosticsReply | undefined> {
  try {
    // The published Connection package augments one Cordis key with both faces;
    // this file is bundled for the Client face only, where `call` exists.
    const rpc = ctx.connection?.rpc as unknown as ClientConnectionRpc | undefined
    if (rpc === undefined || typeof rpc.call !== 'function') return undefined
    const result = await rpc.call(PROJECTLESS_RPC_CHANNEL, diagnosticsEndpoint(), { ...payload, at: Date.now() })
    return (result as { value?: DiagnosticsReply } | undefined)?.value
  } catch {
    // Diagnostics must never break the page they observe.
    return undefined
  }
}
