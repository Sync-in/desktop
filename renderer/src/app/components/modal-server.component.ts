/*
 * Copyright (C) 2012-2025 Johan Legrand <johan.legrand@sync-in.com>
 * This file is part of Sync-in | The open source file sync and share solution
 * See the LICENSE file for licensing details
 */
import { Component, inject, OnInit } from '@angular/core'
import { AppService } from '../app.service'
import { ReactiveFormsModule, UntypedFormBuilder, UntypedFormGroup, Validators } from '@angular/forms'
import { LOCAL_RENDERER } from '../../../../main/constants/events'
import { L10N_LOCALE, L10nLocale, L10nTranslateDirective, L10nTranslatePipe } from 'angular-l10n'
import { AutofocusDirective } from '../common/directives/auto-focus.directive'
import { FaIconComponent, IconDefinition } from '@fortawesome/angular-fontawesome'
import { faIcons } from '../common/icons'
import { SyncServer } from '../../../../core/components/interfaces/server.interface'
import { SERVER_ACTION } from '../../../../core/components/constants/server'

@Component({
  selector: 'app-modal-server',
  templateUrl: './modal-server.component.html',
  imports: [L10nTranslatePipe, ReactiveFormsModule, AutofocusDirective, L10nTranslateDirective, FaIconComponent],
  standalone: true
})
export class ModalServerComponent implements OnInit {
  public config: { type: SERVER_ACTION; server: SyncServer } = null
  public titleIcon: IconDefinition = null
  public titleText: string = null
  public activeServer: SyncServer = null
  public loginForm: UntypedFormGroup = null
  public hasError = false
  public textError = ''
  public submitted = false
  protected locale = inject<L10nLocale>(L10N_LOCALE)
  protected icons = faIcons
  protected isAddModal = false
  protected isRemoveModal = false
  protected isAuthenticationModal = false
  private readonly appService = inject(AppService)
  private readonly fb = inject(UntypedFormBuilder)

  constructor() {
    this.appService.activeServer.subscribe((server: SyncServer) => (this.activeServer = server))
  }

  ngOnInit() {
    switch (this.config.type) {
      case SERVER_ACTION.ADD:
        this.isAddModal = true
        this.titleIcon = this.icons.faPlus
        this.titleText = 'Connect to a server'
        break
      case SERVER_ACTION.AUTHENTICATE:
        this.isAuthenticationModal = true
        this.titleIcon = this.icons.faKey
        this.titleText = 'Authenticate on the server'
        break
      case SERVER_ACTION.REMOVE:
        this.isRemoveModal = true
        this.titleIcon = this.icons.faTrashAlt
        this.titleText = 'Delete the server'
        break
      default:
        this.titleIcon = this.icons.faPencil
        this.titleText = 'Edit the server'
    }
    if (this.isAddModal) {
      this.loginForm = this.fb.group({
        name: this.fb.control(this.isAddModal ? '' : this.config.server.name, [Validators.required]),
        url: this.fb.control(this.isAddModal ? '' : this.config.server.url, [Validators.required]),
        login: this.fb.control('', [Validators.required]),
        password: this.fb.control('', [Validators.required])
      })
    } else {
      // remove / edit / auth modal
      this.loginForm = this.fb.group({
        name: this.fb.control({ value: this.config.server.name, disabled: this.isAuthenticationModal }, [Validators.required]),
        url: this.fb.control({ value: this.config.server.url, disabled: true }, [Validators.required]),
        ...(this.isAuthenticationModal
          ? {
              login: this.fb.control('', [Validators.required]),
              password: this.fb.control('', [Validators.required])
            }
          : {})
      })
    }
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
      .invoke(
        LOCAL_RENDERER.SERVER.ACTION,
        this.config.type,
        {
          id: this.config.server ? this.config.server.id : null,
          name: this.serverName(),
          url: this.serverURL(),
          available: this.config.server ? this.config.server.available : false
        },
        { login: this.loginForm.value.login, password: this.loginForm.value.password }
      )
      .then((info: { ok: boolean; msg?: string }) => this.onServerCheck(info))
  }

  private onServerCheck(info: { ok: boolean; msg?: string }) {
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
}
