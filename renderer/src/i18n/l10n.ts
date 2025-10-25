/*
 * Copyright (C) 2012-2025 Johan Legrand <johan.legrand@sync-in.com>
 * This file is part of Sync-in | The open source file sync and share solution
 * See the LICENSE file for licensing details
 */
import { Injectable } from '@angular/core'
import { L10nConfig, L10nFormat, L10nLocale, L10nStorage } from 'angular-l10n'
import enLocale from '../../../i18n/en.json'
import frLocale from '../../../i18n/fr.json'
import deLocale from '../../../i18n/de.json'
import esLocale from '../../../i18n/es.json'
import hiLocale from '../../../i18n/hi.json'
import itLocale from '../../../i18n/it.json'
import jaLocale from '../../../i18n/ja.json'
import koLocale from '../../../i18n/ko.json'
import plLocale from '../../../i18n/pl.json'
import ptLocale from '../../../i18n/pt.json'
import ptBRLocale from '../../../i18n/pt-BR.json'
import ruLocale from '../../../i18n/ru.json'
import trLocale from '../../../i18n/tr.json'
import zhLocale from '../../../i18n/zh.json'
import { i18nLocaleSupported } from '../../../i18n'

export const i18nAsset: Record<i18nLocaleSupported, any> = {
  de: deLocale,
  en: enLocale,
  es: esLocale,
  fr: frLocale,
  hi: hiLocale,
  it: itLocale,
  ja: jaLocale,
  ko: koLocale,
  pl: plLocale,
  pt: ptLocale,
  'pt-BR': ptBRLocale,
  ru: ruLocale,
  tr: trLocale,
  zh: zhLocale
}

export const STORAGE_SESSION_KEY = 'locale' as const
export const LANG_FORMAT: L10nFormat = 'language-region' as const

export const l10nConfig: L10nConfig & {
  schema: { locale: { language: i18nLocaleSupported }; dir: 'ltr' | 'rtl' }[]
} = {
  format: LANG_FORMAT,
  providers: [{ name: 'app', asset: i18nAsset }],
  fallback: false,
  cache: true,
  keySeparator: '|',
  defaultLocale: { language: 'en' },
  schema: [
    { locale: { language: 'de' }, dir: 'ltr' },
    { locale: { language: 'en' }, dir: 'ltr' },
    { locale: { language: 'es' }, dir: 'ltr' },
    { locale: { language: 'fr' }, dir: 'ltr' },
    { locale: { language: 'hi' }, dir: 'ltr' },
    { locale: { language: 'it' }, dir: 'ltr' },
    { locale: { language: 'ja' }, dir: 'ltr' },
    { locale: { language: 'ko' }, dir: 'ltr' },
    { locale: { language: 'pl' }, dir: 'ltr' },
    { locale: { language: 'pt' }, dir: 'ltr' },
    { locale: { language: 'pt-BR' }, dir: 'ltr' },
    { locale: { language: 'ru' }, dir: 'ltr' },
    { locale: { language: 'tr' }, dir: 'ltr' },
    { locale: { language: 'zh' }, dir: 'ltr' }
  ]
}

@Injectable({ providedIn: 'root' })
export class TranslationStorage implements L10nStorage {
  private readonly hasStorage = typeof Storage !== 'undefined'

  async read(): Promise<L10nLocale | null> {
    if (!this.hasStorage) return null
    let stored: L10nLocale | null = null
    const raw = sessionStorage.getItem(STORAGE_SESSION_KEY)
    if (raw) {
      try {
        stored = JSON.parse(raw)
      } catch (e) {
        console.warn('Invalid locale in sessionStorage, resetting.', e)
        sessionStorage.removeItem(STORAGE_SESSION_KEY)
      }
    }
    const lang = stored?.language
    const isSupported = !!lang && Object.hasOwn(i18nAsset, lang)
    if (!isSupported) {
      sessionStorage.removeItem(STORAGE_SESSION_KEY)
      return null
    }
    return stored
  }

  async write(locale: L10nLocale): Promise<void> {
    if (!this.hasStorage) return
    try {
      const value = JSON.stringify(locale)
      sessionStorage.setItem(STORAGE_SESSION_KEY, value)
    } catch (e) {
      console.warn('Failed to write locale to sessionStorage:', e)
    }
  }
}
