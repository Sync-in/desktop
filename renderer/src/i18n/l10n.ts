import { inject, Injectable } from '@angular/core'
import {
  getBrowserLanguage,
  getSchema,
  L10N_CONFIG,
  L10nConfig,
  L10nFormat,
  L10nLocale,
  L10nLocaleResolver,
  L10nStorage,
  L10nTranslationLoader
} from 'angular-l10n'
import { i18nLocaleSupported, LANG_SUPPORTED, normalizeLanguage } from '../../../i18n'
import { catchError, from, map, Observable, of } from 'rxjs'
import { BsLocaleService } from 'ngx-bootstrap/datepicker'
import { loadDayjsLocale } from './lib/dayjs.i18n'
import { loadBootstrapLocale } from './lib/bs.i18n'

export const STORAGE_SESSION_KEY = 'locale' as const
export const LANG_FORMAT: L10nFormat = 'language-region' as const

export const l10nConfig: L10nConfig & {
  schema: { locale: { language: i18nLocaleSupported }; dir: 'ltr' | 'rtl' }[]
} = {
  format: LANG_FORMAT,
  providers: [{ name: 'app', asset: 'app' }],
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
    const isSupported = !!lang && LANG_SUPPORTED.has(lang as i18nLocaleSupported)
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

@Injectable()
export class TranslationLoader implements L10nTranslationLoader {
  private readonly bsLocale = inject(BsLocaleService)

  get(language: string): Observable<Record<string, any>> {
    if (language) {
      loadBootstrapLocale(language)
      loadDayjsLocale(language).catch(console.error)
      this.bsLocale.use(language.toLowerCase())
    } else {
      return of({})
    }
    // Dynamically load the JSON file for the requested language
    return from(import(`../../../i18n/${language}.json`)).pipe(
      map((module: any) => module?.default ?? module ?? {}),
      catchError(() => of({}))
    )
  }
}

@Injectable()
export class TranslateLocaleResolver implements L10nLocaleResolver {
  private readonly config = inject(L10N_CONFIG)

  public async get(): Promise<L10nLocale | null> {
    const browserLanguage = normalizeLanguage(getBrowserLanguage(LANG_FORMAT))
    if (browserLanguage) {
      const schema = getSchema(this.config.schema, browserLanguage, LANG_FORMAT)
      if (schema) {
        return Promise.resolve(schema.locale)
      }
    }
    return Promise.resolve(null)
  }
}
