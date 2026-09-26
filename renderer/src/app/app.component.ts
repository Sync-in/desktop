import { Component, effect, inject, OnInit } from '@angular/core'
import { AppService } from './app.service'
import { LOCAL_RENDERER } from '../../../main/constants/events'
import { L10nTranslateDirective } from 'angular-l10n'
import { LucideDynamicIcon, LucideRefreshCw } from '@lucide/angular'
import { TopBarComponent } from './components/top-bar.component'
import { BottomBarComponent } from './components/bottom-bar-component'
import { THEME } from '../../../main/constants/themes'
import type { SyncServer } from '@sync-in-desktop/core/components/interfaces/server.interface'

@Component({
  selector: 'app-root',
  imports: [TopBarComponent, BottomBarComponent, L10nTranslateDirective, LucideDynamicIcon],
  templateUrl: './app.component.html',
  standalone: true
})
export class AppComponent implements OnInit {
  public activeServer = null
  public isRetrying = false
  protected readonly appService = inject(AppService)
  protected readonly icons = { LucideRefreshCw }

  constructor() {
    this.appService.activeServer.subscribe((server: SyncServer) => this.setActiveServer(server))
    effect(() => this.setBodyThemeClass(this.appService.themeMode()))
  }

  ngOnInit() {
    this.appService.updateServers()
  }

  retryLoad() {
    if (this.isRetrying) {
      return
    }
    this.isRetrying = true
    this.appService.ipcRenderer.invoke(LOCAL_RENDERER.SERVER.RETRY, this.activeServer.id).then((state: boolean) => {
      this.retryServer(state)
    })
  }

  private retryServer(state: boolean) {
    if (this.isRetrying) {
      this.isRetrying = false
      this.activeServer.available = state
    }
  }

  private setActiveServer(server: SyncServer) {
    this.activeServer = server
  }

  private setBodyThemeClass(theme: THEME) {
    document.body.classList.remove(THEME.DARK, THEME.LIGHT)
    document.body.classList.add(theme)
  }
}
