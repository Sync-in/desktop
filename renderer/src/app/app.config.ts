import { HashLocationStrategy, LocationStrategy } from '@angular/common'
import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core'
import { provideAnimations } from '@angular/platform-browser/animations'
import { provideL10nIntl, provideL10nTranslation } from 'angular-l10n'
import { BsModalService } from 'ngx-bootstrap/modal'
import { l10nConfig, TranslateLocaleResolver, TranslationLoader, TranslationStorage } from '../i18n/l10n'

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    { provide: LocationStrategy, useClass: HashLocationStrategy },
    provideL10nTranslation(l10nConfig, {
      localeResolver: TranslateLocaleResolver,
      storage: TranslationStorage,
      translationLoader: TranslationLoader
    }),
    provideL10nIntl(),
    provideAnimations(),
    BsModalService
  ]
}
