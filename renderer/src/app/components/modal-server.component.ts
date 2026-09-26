import { Component, inject, OnInit } from '@angular/core'
import { AppService } from '../app.service'
import { ReactiveFormsModule, UntypedFormBuilder, UntypedFormGroup, Validators } from '@angular/forms'
import { LOCAL_RENDERER } from '../../../../main/constants/events'
import { L10N_LOCALE, L10nLocale, L10nTranslateDirective, L10nTranslatePipe } from 'angular-l10n'
import { AutofocusDirective } from '../common/directives/auto-focus.directive'
import type { LucideIcon } from '@lucide/angular'
import {
  LucideChevronDown,
  LucideDynamicIcon,
  LucideGlobe,
  LucidePencil,
  LucidePlus,
  LucideRefreshCw,
  LucideServer,
  LucideTrash
} from '@lucide/angular'
import { SyncServer, SyncServerEvent } from '../../../../core/components/interfaces/server.interface'
import { SERVER_ACTION } from '../../../../core/components/constants/server'

@Component({
  selector: 'app-modal-server',
  templateUrl: './modal-server.component.html',
  imports: [L10nTranslatePipe, ReactiveFormsModule, AutofocusDirective, L10nTranslateDirective, LucideDynamicIcon],
  standalone: true
})
export class ModalServerComponent implements OnInit {
  public config: { type: SERVER_ACTION; server: SyncServer } = null
  public titleIcon: LucideIcon = null
  public titleText: string = null
  public activeServer: SyncServer = null
  public loginForm: UntypedFormGroup = null
  public hasError = false
  public textError = ''
  public submitted = false
  protected locale = inject<L10nLocale>(L10N_LOCALE)
  protected readonly icons = { LucideChevronDown, LucideGlobe, LucidePencil, LucidePlus, LucideRefreshCw, LucideServer, LucideTrash }
  protected isAddModal = false
  protected isRemoveModal = false
  protected showAdvancedOptions = false
  private readonly appService = inject(AppService)
  private readonly fb = inject(UntypedFormBuilder)

  constructor() {
    this.appService.activeServer.subscribe((server: SyncServer) => (this.activeServer = server))
  }

  ngOnInit() {
    switch (this.config.type) {
      case SERVER_ACTION.ADD:
        this.isAddModal = true
        this.titleIcon = this.icons.LucidePlus
        this.titleText = 'Connect to a server'
        break
      case SERVER_ACTION.REMOVE:
        this.isRemoveModal = true
        this.titleIcon = this.icons.LucideTrash
        this.titleText = 'Delete the server'
        break
      case SERVER_ACTION.EDIT:
        this.titleIcon = this.icons.LucidePencil
        this.titleText = 'Edit the server'
        break
      default:
        throw new Error(`Unknown server action: ${this.config.type}`)
    }
    this.loginForm = this.fb.group({
      name: this.fb.control({ value: this.isAddModal ? '' : this.config.server.name, disabled: this.isRemoveModal }, [Validators.required]),
      url: this.fb.control({ value: this.isAddModal ? '' : this.config.server.url, disabled: !this.isAddModal }, [Validators.required]),
      allowInvalidCertificate: this.fb.control({
        value: this.isAddModal ? false : this.config.server.allowInvalidCertificate === true,
        disabled: this.isRemoveModal
      })
    })
    this.showAdvancedOptions = this.allowInvalidCertificate()
  }

  closeModal() {
    this.appService.closeDialog()
  }

  onSubmit() {
    if (this.loginForm.invalid) {
      return
    }
    this.hasError = false
    this.textError = ''
    this.submitted = true
    this.appService.ipcRenderer
      .invoke(LOCAL_RENDERER.SERVER.ACTION, this.config.type, {
        id: this.config.server ? this.config.server.id : null,
        name: this.serverName(),
        url: this.serverURL(),
        available: this.config.server ? this.config.server.available : false,
        allowInvalidCertificate: this.allowInvalidCertificate()
      })
      .then((info: SyncServerEvent) => this.onServerCheck(info))
  }

  private onServerCheck(info: SyncServerEvent) {
    if (info.ok) {
      this.closeModal()
    } else {
      this.textError = info.msg
      this.hasError = true
    }
    this.submitted = false
  }

  private serverName() {
    return this.loginForm.value?.name?.trim()
  }

  private serverURL() {
    return this.loginForm.value?.url?.trim().replace(/\/+$/, '').toLowerCase()
  }

  private allowInvalidCertificate() {
    return this.loginForm.get('allowInvalidCertificate')?.value === true
  }

  protected toggleAdvancedOptions() {
    this.showAdvancedOptions = !this.showAdvancedOptions
  }
}
