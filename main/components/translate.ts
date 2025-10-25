/*
 * Copyright (C) 2012-2025 Johan Legrand <johan.legrand@sync-in.com>
 * This file is part of Sync-in | The open source file sync and share solution
 * See the LICENSE file for licensing details
 */

import fs from 'node:fs'
import path from 'node:path'
import { i18nLocaleSupported, LANG_DEFAULT, normalizeLanguage } from '../../i18n'

class i18nManager {
  i18nPath = path.join(__dirname, 'i18n')
  language: i18nLocaleSupported = LANG_DEFAULT
  dictionary: any = {}

  constructor() {
    this.load()
  }

  tr(phrase: string) {
    const translation = this.dictionary[phrase]
    return translation === undefined ? phrase : translation
  }

  updateLanguage(language: string) {
    language = normalizeLanguage(language) || LANG_DEFAULT
    if (this.language !== language) {
      this.language = language as i18nLocaleSupported
      this.load()
    }
  }

  private load() {
    const lang = fs.existsSync(path.join(this.i18nPath, `${this.language}.json`)) ? `${this.language}.json` : `${LANG_DEFAULT}.json`
    this.dictionary = JSON.parse(fs.readFileSync(path.join(this.i18nPath, lang), 'utf8'))
  }
}

export const i18n: i18nManager = new i18nManager()
