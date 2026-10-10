import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { report } from './diagnostics.ts'

/**
 * One scripted round trip through the whole feature: start a Session that
 * belongs to no Workspace, type into it without the composer being inert,
 * actually send the message, click away, click back, and report what survived.
 *
 * It runs only when the Host hands out the `projectless-selftest` command (see
 * `commandsFile`), because it opens a real Session on screen and sends one real
 * prompt. Every step is reported as one diagnostics line, so the outcome is
 * inspectable from outside the page instead of by hand.
 */

const PROMPT = 'Reply with exactly: OK. Do not use any tools.'

export interface ProjectlessSelftestDeps {
  startProjectlessSession(): Promise<SessionId>
  openSession(sessionId: SessionId): void
  currentSessionId(): SessionId | undefined
  cwdOf(sessionId: SessionId): string | undefined
  hasWorkspace(sessionId: SessionId): boolean
  blank(sessionId: SessionId): boolean | undefined
  root(): Promise<string>
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

/** The composer is a contenteditable div (or a textarea on older builds). */
function findComposer(): HTMLElement | undefined {
  for (const selector of ['[data-composer-input]', '[contenteditable]', '[role="textbox"]', 'textarea']) {
    const found = document.querySelector<HTMLElement>(selector)
    if (found !== null) return found
  }
  return undefined
}

function describeComposer(element: HTMLElement | undefined): Record<string, unknown> | null {
  if (element === undefined) return null
  return {
    tag: element.tagName,
    cls: String(element.className).slice(0, 60),
    contentEditable: element.getAttribute('contenteditable'),
    disabled: element.getAttribute('aria-disabled') ?? (element as HTMLTextAreaElement).disabled ?? null,
    text: (element.textContent ?? '').slice(0, 60),
  }
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

/** Press Enter in the composer, which is how DSH submits a prompt. */
function pressEnter(element: HTMLElement): boolean {
  try {
    element.focus()
    const options = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }
    const down = new KeyboardEvent('keydown', options)
    element.dispatchEvent(down)
    element.dispatchEvent(new KeyboardEvent('keyup', options))
    return true
  } catch {
    return false
  }
}

function sidebarSections(): number {
  try {
    return document.querySelectorAll('[role="tree"] > div').length
  } catch {
    return -1
  }
}

/** Rows inside the section DSH marks as the plain-Session bucket. */
function ungrouplessRows(): number {
  try {
    for (const section of document.querySelectorAll('[role="tree"] > div')) {
      if (section.querySelector('[data-row-key="workspace:"]') === null) continue
      return section.querySelectorAll('[data-row-key^="session:"]').length
    }
  } catch { /* no sidebar yet */ }
  return -1
}

/** What the main area currently renders, so a missing composer can be diagnosed. */
function domProbe(): Record<string, unknown> {
  const count = (selector: string): number => {
    try {
      return document.querySelectorAll(selector).length
    } catch {
      return -1
    }
  }
  let center: string | null = null
  try {
    const column = document.querySelector('[class*="centerCol"]')
    center = column?.firstElementChild === null || column === null
      ? null
      : String(column.firstElementChild?.className ?? '').slice(0, 90)
  } catch { /* no layout yet */ }
  // DSH stamps the Session it bound onto its own conversation root, so reading
  // it separates "the view never bound a Session" from "the slot hid the id".
  let boundSession: string | null = null
  try {
    boundSession = document.querySelector('[data-conversation-content]')?.getAttribute('data-conversation-session') ?? null
  } catch { /* no view yet */ }
  return {
    composerHosts: count('[data-composer-input]'),
    textboxes: count('[role="textbox"]'),
    editables: count('[contenteditable]'),
    textareas: count('textarea'),
    sections: sidebarSections(),
    center,
    boundSession,
  }
}

function visibleAlert(): string | null {
  try {
    const alert = document.querySelector('[role="alert"]')
    const text = String(alert?.textContent ?? '').trim()
    return text === '' ? null : text.slice(0, 160)
  } catch {
    return null
  }
}

export async function runProjectlessSelftest(
  ctx: Context,
  deps: ProjectlessSelftestDeps,
): Promise<void> {
  const mark = `DSH-PROJECTLESS-PROBE-${Date.now().toString(36)}`
  const startedFrom = deps.currentSessionId()
  const result: Record<string, unknown> = { mark, startedFrom: startedFrom ?? null }
  let target: SessionId | undefined
  try {
    result.sectionsBefore = sidebarSections()
    result.root = await deps.root()
    target = await deps.startProjectlessSession()
    result.createdSession = target
    await wait(1800)
    result.afterCreate = {
      current: deps.currentSessionId() ?? null,
      cwd: deps.cwdOf(target) ?? null,
      hasWorkspace: deps.hasWorkspace(target),
      blank: deps.blank(target) ?? null,
      sections: sidebarSections(),
      ungrouplessRows: ungrouplessRows(),
      dom: domProbe(),
    }
    // Reuse check: a second "new Session" must reopen the same Session — not
    // create a fresh one on a fresh directory.
    const second = await deps.startProjectlessSession()
    await wait(1200)
    result.reuse = {
      sessionId: String(second),
      sameSession: second === target,
      cwd: deps.cwdOf(second) ?? null,
      sections: sidebarSections(),
      ungrouplessRows: ungrouplessRows(),
    }

    const composer = findComposer()
    result.composer = describeComposer(composer)
    if (composer !== undefined) {
      // Draft survival across "new Session": type, click away, click new
      // Session again, come back — the text has to still be there.
      result.typed = typeInto(composer, PROMPT)
      await wait(900)
      result.draftAfterTyping = readDraft(target)
      if (startedFrom !== undefined) deps.openSession(startedFrom)
      await wait(1400)
      const third = await deps.startProjectlessSession()
      await wait(1400)
      const returnedComposer = findComposer()
      result.draftKept = {
        sameSession: third === target,
        draft: readDraft(target),
        composerText: composerText(returnedComposer).slice(0, 80),
        sections: sidebarSections(),
      }

      const sendTarget = returnedComposer ?? findComposer()
      result.enterPressed = sendTarget === undefined ? false : pressEnter(sendTarget)
      await wait(6000)
      result.afterSend = {
        blank: deps.blank(target) ?? null,
        draft: readDraft(target),
        composerText: composerText(findComposer()).slice(0, 80),
        alert: visibleAlert(),
      }
    }
    if (startedFrom !== undefined) deps.openSession(startedFrom)
    await wait(1600)
    result.afterLeaving = {
      current: deps.currentSessionId() ?? null,
      hasWorkspace: deps.hasWorkspace(target),
      blank: deps.blank(target) ?? null,
      draft: readDraft(target),
    }
    deps.openSession(target)
    await wait(1800)
    const returned = {
      current: deps.currentSessionId() ?? null,
      composer: describeComposer(findComposer()),
      composerText: composerText(findComposer()).slice(0, 120),
      draft: readDraft(target),
    }
    result.afterReturning = returned
    result.restored = returned.draft === PROMPT
  } catch (reason) {
    result.error = String(reason).slice(0, 300)
  } finally {
    if (startedFrom !== undefined) {
      try { deps.openSession(startedFrom) } catch { /* the Session is gone */ }
    }
    report(ctx, { phase: 'projectless-selftest', ...result })
  }
}
