/*
 * Copyright (C) 2012-2025 Johan Legrand <johan.legrand@sync-in.com>
 * This file is part of Sync-in | The open source file sync and share solution
 * See the LICENSE file for licensing details
 */

import { HashLocationStrategy, LocationStrategy } from '@angular/common'
import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core'
import { provideAnimations } from '@angular/platform-browser/animations'
import { provideL10nIntl, provideL10nTranslation } from 'angular-l10n'
import { BsModalService } from 'ngx-bootstrap/modal'
import { l10nConfig, TranslationStorage } from '../i18n/l10n'

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    { provide: LocationStrategy, useClass: HashLocationStrategy },
    provideL10nTranslation(l10nConfig, { storage: TranslationStorage }),
    provideL10nIntl(),
    provideAnimations(),
    BsModalService
  ]
}
