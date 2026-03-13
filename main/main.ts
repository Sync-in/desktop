import { app } from 'electron'
import { IS_LINUX } from '../core/constants'

function ensureLinuxAppImageNoSandbox() {
  if (!IS_LINUX || !process.env.APPIMAGE) {
    return false
  }
  const hasNoSandbox = process.argv.includes('--no-sandbox')
  const hasDisableSetuidSandbox = process.argv.includes('--disable-setuid-sandbox')
  if (hasNoSandbox && hasDisableSetuidSandbox) {
    return false
  }

  const args = [...process.argv.slice(1)]
  if (!hasNoSandbox) {
    args.push('--no-sandbox')
  }
  if (!hasDisableSetuidSandbox) {
    args.push('--disable-setuid-sandbox')
  }

  app.relaunch({ args })
  app.exit(0)
  return true
}

function applyElectronSwitches() {
  // app.disableHardwareAcceleration()
  // app.commandLine.appendSwitch('log-file', MAIN_LOGS_FILE)
  // app.commandLine.appendSwitch('enable-logging')
  // app.commandLine.appendSwitch('lang', 'zh-CN')
  app.commandLine.appendSwitch('ignore-certificate-errors')
}

async function bootstrap() {
  if (ensureLinuxAppImageNoSandbox()) {
    return
  }
  applyElectronSwitches()
  const { MainManager } = await import('./components/main-manager')
  const mainManager = new MainManager()
  mainManager.start()
}

bootstrap().catch(console.error)
