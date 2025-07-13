/*
 * Sync-in | The open source file sync and share solution
 * Copyright (C) 2024-2025 Johan Legrand <johan@sync-in.com>
 * This program is licensed under the Affero General Public License (AGPL) version 3.
 * See the LICENSE file or <https://www.gnu.org/licenses/agpl-3.0.html> for more details.
 */
import { Injectable } from '@angular/core'
import { L10nConfig, L10nLocale, L10nStorage } from 'angular-l10n'
import 'dayjs/locale/fr'
import enLocale from './en.json'
import frLocale from './fr.json'

export const i18nAsset: any = { en: enLocale, fr: frLocale }

export const l10nConfig: L10nConfig = {
  format: 'language',
  providers: [{ name: 'app', asset: i18nAsset }],
  fallback: false,
  cache: true,
  keySeparator: '|',
  defaultLocale: { language: 'en' },
  schema: [
    { locale: { language: 'en' }, dir: 'ltr', text: 'United States' },
    { locale: { language: 'fr' }, dir: 'ltr', text: 'France' }
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
