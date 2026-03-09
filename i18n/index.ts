export const LANG_SUPPORTED = new Set(['de', 'en', 'es', 'fr', 'hi', 'it', 'ja', 'ko', 'nl', 'pl', 'pt', 'pt-BR', 'ru', 'tr', 'zh'] as const)
export type i18nLocaleSupported = typeof LANG_SUPPORTED extends Set<infer T> ? T : never
export const LANG_DEFAULT: i18nLocaleSupported = 'en'

export function normalizeLanguage(language: string): i18nLocaleSupported | null {
  if (!language) return null
  if (LANG_SUPPORTED.has(language as i18nLocaleSupported)) {
    return language as i18nLocaleSupported
  }
  const code = language.split('-')[0]
  return LANG_SUPPORTED.has(code as i18nLocaleSupported) ? (code as i18nLocaleSupported) : null
}
