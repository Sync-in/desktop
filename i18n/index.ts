const LANG_SUPPORTED_VALUES = [
  'af',
  'be',
  'bg',
  'bs',
  'ca',
  'cs',
  'da',
  'de',
  'el',
  'en',
  'eo',
  'es',
  'et',
  'fi',
  'fil',
  'fr',
  'ga',
  'gl',
  'hi',
  'hr',
  'hu',
  'id',
  'ig',
  'is',
  'it',
  'ja',
  'ka',
  'kk',
  'ko',
  'lo',
  'lt',
  'lv',
  'mk',
  'mn',
  'ms',
  'nl',
  'nn',
  'no',
  'pl',
  'pt',
  'pt-BR',
  'ro',
  'ru',
  'si',
  'sk',
  'sl',
  'sq',
  'sr',
  'sv',
  'sw',
  'ta',
  'th',
  'tr',
  'uk',
  'uz',
  'vi',
  'zh'
] as const
export type i18nLocaleSupported = (typeof LANG_SUPPORTED_VALUES)[number]
export const LANG_SUPPORTED = new Set<i18nLocaleSupported>(LANG_SUPPORTED_VALUES)
export const LANG_DEFAULT: i18nLocaleSupported = 'en'

export function normalizeLanguage(language: string): i18nLocaleSupported | null {
  if (!language) return null

  const normalizedLanguage = language.trim().replace(/_/g, '-').split(/[.@]/, 1)[0].toLowerCase()
  const supportedLanguage = LANG_SUPPORTED_VALUES.find((code) => code.toLowerCase() === normalizedLanguage)
  if (supportedLanguage) return supportedLanguage

  const code = normalizedLanguage.split('-')[0]
  if (code === 'nb') return 'no'
  if (code === 'tl') return 'fil'
  return LANG_SUPPORTED.has(code as i18nLocaleSupported) ? (code as i18nLocaleSupported) : null
}

export function resolveSupportedLanguage(languages: readonly string[]): i18nLocaleSupported {
  for (const language of languages) {
    const normalizedLanguage = normalizeLanguage(language)
    if (normalizedLanguage) return normalizedLanguage
  }
  return LANG_DEFAULT
}
