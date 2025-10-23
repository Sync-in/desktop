/*
 * Copyright (C) 2012-2025 Johan Legrand <johan.legrand@sync-in.com>
 * This file is part of Sync-in | The open source file sync and share solution
 * See the LICENSE file for licensing details
 */
import { Injectable } from '@angular/core'
import { L10nConfig, L10nLocale, L10nStorage } from 'angular-l10n'
import 'dayjs/locale/fr'
import 'dayjs/locale/de.js'
import 'dayjs/locale/es.js'
import 'dayjs/locale/pt.js'
import 'dayjs/locale/it.js'
import 'dayjs/locale/zh.js'
import 'dayjs/locale/hi.js'
import 'dayjs/locale/ru.js'
import enLocale from '../../../i18n/en.json'
import frLocale from '../../../i18n/fr.json'
import deLocale from '../../../i18n/de.json'
import itLocale from '../../../i18n/it.json'
import ptLocale from '../../../i18n/pt.json'
import zhLocale from '../../../i18n/zh.json'
import hiLocale from '../../../i18n/hi.json'
import ruLocale from '../../../i18n/ru.json'

export const i18nAsset: any = { en: enLocale, fr: frLocale, de: deLocale, it: itLocale, pt: ptLocale, zh: zhLocale, hi: hiLocale, ru: ruLocale }

export const l10nConfig: L10nConfig = {
  format: 'language',
  providers: [{ name: 'app', asset: i18nAsset }],
  fallback: false,
  cache: true,
  keySeparator: '|',
  defaultLocale: { language: 'en' },
  schema: [
    { locale: { language: 'en' }, dir: 'ltr' },
    { locale: { language: 'fr' }, dir: 'ltr' },
    { locale: { language: 'de' }, dir: 'ltr' },
    { locale: { language: 'es' }, dir: 'ltr' },
    { locale: { language: 'it' }, dir: 'ltr' },
    { locale: { language: 'pt' }, dir: 'ltr' },
    { locale: { language: 'hi' }, dir: 'ltr' },
    { locale: { language: 'zh' }, dir: 'ltr' },
    { locale: { language: 'ru' }, dir: 'ltr' }
  ]
}

@Injectable({ providedIn: 'root' })
export class TranslationStorage implements L10nStorage {
  hasStorage: boolean

  constructor() {
    this.hasStorage = typeof Storage !== 'undefined'
  }

  public async read(): Promise<L10nLocale | null> {
    if (this.hasStorage) {
      const locale = sessionStorage.getItem('locale')
      return Promise.resolve(locale ? JSON.parse(locale) : locale)
    }
    return Promise.resolve(null)
  }

  public async write(locale: L10nLocale): Promise<void> {
    if (this.hasStorage) {
      sessionStorage.setItem('locale', JSON.stringify(locale))
    }
  }
}
