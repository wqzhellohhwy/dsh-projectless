import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { report } from './diagnostics.ts'

/**
 * One scripted round trip that answers the question a draft has to survive:
 * start a projectless Session, type into it without sending, click away,
 * click back, and see whether the text is still there.
 *
 * It runs only when the Host hands out the `draft-selftest` command (see
 * `commandsFile`), because it opens and closes real Sessions on screen. The
 * steps are reported as one diagnostics line, so the outcome is inspectable
 * from outside the page instead of by hand.
 */

const MARK_PREFIX = 'DSH-PROJECTLESS-DRAFT-PROBE'

export interface SelftestDeps {
  /** Start a projectless Session (the plugin's own provisioning). */
  createProjectlessSession(): Promise<SessionId>
  /** Navigate to a Session. */
  openSession(sessionId: SessionId): void
  /** The Session the main view currently retains, and whether any Session is still blank. */
  snapshot(): { current: SessionId | undefined, blank: (sessionId: SessionId) => boolean | undefined }
  /** Whether a temporary Workspace still accounts for this Session. */
  hasProjectlessWorkspace(sessionId: SessionId): boolean
}

function wait(milliseconds: number): Promise<void> {
  return new Promise<void>((resolve) => { window.setTimeout(resolve, milliseconds) })
}

/** DSH persists the unsent composer text here, keyed by Session. */
function readDraft(sessionId: SessionId): string | null {
  try {
    const raw = localStorage.getItem(`dsh.conversation.${sessionId}`)
    if (raw === null) return null
    const parsed = JSON.parse(raw) as { draft?: unknown }
    return typeof parsed?.draft === 'string' ? parsed.draft : null
  } catch {
    return null
  }
}

function findComposer(): HTMLElement | undefined {
  for (const selector of ['textarea', '[contenteditable="true"]', '[role="textbox"]']) {
    const found = document.querySelector<HTMLElement>(selector)
    if (found !== null) return found
  }
  return undefined
}

function composerText(element: HTMLElement | undefined): string {
  if (element === undefined) return ''
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) return element.value
  return element.textContent ?? ''
}

/** Drive the composer the way a keystroke would, preferring the native setter React listens to. */
function typeInto(element: HTMLElement, text: string): string {
  try {
    element.focus()
    if (element instanceof HTMLTextAreaElement) {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(element, text)
      element.dispatchEvent(new Event('input', { bubbles: true }))
      return 'textarea-value'
    }
    if (element instanceof HTMLInputElement) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(element, text)
      element.dispatchEvent(new Event('input', { bubbles: true }))
      return 'input-value'
    }
    if (typeof document.execCommand === 'function' && document.execCommand('insertText', false, text)) {
      return 'execCommand'
    }
    element.textContent = text
    element.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }))
    return 'textContent'
  } catch (reason) {
    return `failed:${String(reason).slice(0, 80)}`
  }
}

export async function runDraftSelftest(ctx: Context, deps: SelftestDeps): Promise<void> {
  const mark = `${MARK_PREFIX}-${Date.now().toString(36)}`
  const startedFrom = deps.snapshot().current
  let target: SessionId | undefined
  let result: Record<string, unknown> = { mark, startedFrom: startedFrom ?? null }
  try {
    target = await deps.createProjectlessSession()
    result.createdSession = target
    await wait(1500)
    const composer = findComposer()
    result.currentAfterCreate = deps.snapshot().current ?? null
    result.composer = composer === undefined ? null : `${composer.tagName}.${String(composer.className).slice(0, 60)}`
    if (composer !== undefined) result.typed = typeInto(composer, mark)
    await wait(1000)
    result.draftAfterTyping = readDraft(target)

    if (startedFrom !== undefined) deps.openSession(startedFrom)
    await wait(1600)
    result.afterLeaving = {
      current: deps.snapshot().current ?? null,
      blank: deps.snapshot().blank(target) ?? null,
      workspaceKept: deps.hasProjectlessWorkspace(target),
      draft: readDraft(target),
    }

    deps.openSession(target)
    await wait(1800)
    const returned = {
      current: deps.snapshot().current ?? null,
      composerText: composerText(findComposer()),
      draft: readDraft(target),
    }
    result.afterReturning = returned
    result.restored = returned.composerText.includes(mark) || returned.draft === mark
  } catch (reason) {
    result.error = String(reason).slice(0, 300)
  } finally {
    if (startedFrom !== undefined) {
      try { deps.openSession(startedFrom) } catch { /* the Session is gone */ }
    }
    report(ctx, { phase: 'draft-selftest', ...result })
  }
}
