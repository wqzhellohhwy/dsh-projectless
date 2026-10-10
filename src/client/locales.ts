import type { LocaleDictOf } from '@deepseek-ai/dsh-client-ui-slots'

export const PROJECTLESS_LOCALE_NS = 'projectless'

export const zh = {
  'picker.projectless': '无工作区会话',
  'picker.addWorkspace': '添加工作区…',
  'modal.createFailed': '无法创建无工作区会话',
  'modal.close': '知道了',
  /**
   * The working directory every projectless Session shares is named after this
   * string, and DSH puts a directory's basename on the hero's workspace chip —
   * so this string is also what that chip reads. Wording matches DSH's own
   * `group.ungrouped` in `dsh-client-ui-workspace`.
   */
  'group.ungrouped': '未分组',
} as const

export type ProjectlessLocaleKey = keyof typeof zh

export const en: Record<ProjectlessLocaleKey, string> = {
  'picker.projectless': 'Session without workspace',
  'picker.addWorkspace': 'Add workspace…',
  'modal.createFailed': 'Could not create session without workspace',
  'modal.close': 'Got it',
  'group.ungrouped': 'Ungrouped',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Projectless-session picker and error copy. */
    projectless: ProjectlessLocaleKey
  }
}

/** Typed bilingual dictionaries consumed by the DSH locale runtime. */
export const projectlessLocales: Record<'zh' | 'en', LocaleDictOf<typeof PROJECTLESS_LOCALE_NS>> = {
  zh,
  en,
}
