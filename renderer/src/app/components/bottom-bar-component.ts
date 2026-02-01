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
