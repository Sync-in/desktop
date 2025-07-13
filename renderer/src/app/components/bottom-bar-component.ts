/*
 * Copyright (C) 2012-2025 Johan Legrand <johan.legrand@sync-in.com>
 * This file is part of Sync-in | The open source file sync and share solution
 * See the LICENSE file for licensing details
 */

import { Component } from '@angular/core'
import { BottomBarDownloadsComponent } from './bottom-bar-downloads.component'
import { BottomBarSyncsComponent } from './bottom-bar-syncs.component'

@Component({
  selector: 'app-bottom-bar-component',
  templateUrl: 'bottom-bar.component.html',
  imports: [BottomBarDownloadsComponent, BottomBarSyncsComponent],
  standalone: true
})
export class BottomBarComponent {}
