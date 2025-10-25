/*
 * Copyright (C) 2012-2025 Johan Legrand <johan.legrand@sync-in.com>
 * This file is part of Sync-in | The open source file sync and share solution
 * See the LICENSE file for licensing details
 */

export type i18nLocaleSupported = 'de' | 'en' | 'es' | 'fr' | 'hi' | 'it' | 'ja' | 'ko' | 'pl' | 'pt' | 'pt-BR' | 'ru' | 'tr' | 'zh'
export const LANG_SUPPORTED = new Set<i18nLocaleSupported>(['de', 'en', 'es', 'fr', 'hi', 'it', 'ja', 'ko', 'pl', 'pt', 'pt-BR', 'ru', 'tr', 'zh'])
export const LANG_DEFAULT: i18nLocaleSupported = 'en'

export function normalizeLanguage(lang: string): i18nLocaleSupported | null {
  const s = (lang || '').trim()
  if (!s) return null
  if (LANG_SUPPORTED.has(s as i18nLocaleSupported)) {
    return s as i18nLocaleSupported
  }
  const base = s.split('-')[0].toLowerCase()
  return LANG_SUPPORTED.has(base as i18nLocaleSupported) ? (base as i18nLocaleSupported) : null
}
