/*
 * Copyright (C) 2012-2025 Johan Legrand <johan.legrand@sync-in.com>
 * This file is part of Sync-in | The open source file sync and share solution
 * See the LICENSE file for licensing details
 */

import fs from 'node:fs'
import path from 'node:path'

class i18nManager {
  i18nPath: string
  locale: string
  language: string
  dictionary: any

  constructor(language: string, locale: string) {
    this.i18nPath = path.join(__dirname, 'i18n')
    this.locale = locale
    this.language = language ? language : this.locale
    this.dictionary = {}
    this.load()
  }

  private load() {
    if (fs.existsSync(path.join(this.i18nPath, `${this.language}.json`))) {
      this.dictionary = JSON.parse(fs.readFileSync(path.join(this.i18nPath, `${this.language}.json`), 'utf8'))
    } else {
      this.dictionary = JSON.parse(fs.readFileSync(path.join(this.i18nPath, 'en.json'), 'utf8'))
    }
  }

  tr(phrase: string) {
    const translation = this.dictionary[phrase]
    return translation === undefined ? phrase : translation
  }

  updateLanguage(language: string) {
    const lang = language ? language : this.locale
    if (this.language !== lang) {
      this.language = lang
      this.load()
    }
  }
}

export const i18n: i18nManager = new i18nManager(null, 'en')
