import {
  defineLocale,
  deLocale,
  enGbLocale,
  esLocale,
  frLocale,
  hiLocale,
  itLocale,
  jaLocale,
  koLocale,
  LocaleData,
  plLocale,
  ptBrLocale,
  ruLocale,
  trLocale,
  zhCnLocale
} from 'ngx-bootstrap/chronos'
import { i18nLocaleSupported } from '../../../../i18n'

const BOOTSTRAP_LOCALES: Record<i18nLocaleSupported, LocaleData> = {
  de: deLocale,
  en: enGbLocale,
  es: esLocale,
  fr: frLocale,
  hi: hiLocale,
  it: itLocale,
  ja: jaLocale,
  ko: koLocale,
  pl: plLocale,
  pt: ptBrLocale,
  'pt-BR': ptBrLocale,
  ru: ruLocale,
  tr: trLocale,
  zh: zhCnLocale
}

export function loadBootstrapLocale(language: string): void {
  const locale: LocaleData = BOOTSTRAP_LOCALES[language]
  if (!locale) return
  defineLocale(language.toLowerCase(), locale)
}
