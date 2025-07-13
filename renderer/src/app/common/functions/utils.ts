/*
 * Copyright (C) 2012-2025 Johan Legrand <johan.legrand@sync-in.com>
 * This file is part of Sync-in | The open source file sync and share solution
 * See the LICENSE file for licensing details
 */

import { THEME } from '../../../../../main/constants/themes'

export function stopEventPropagation(ev: Event) {
  ev.preventDefault()
  ev.stopPropagation()
}

export function getTheme(): THEME {
  if (window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? THEME.DARK : THEME.LIGHT
  }
  return THEME.LIGHT
}
