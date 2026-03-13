const fs = require('node:fs/promises')
const path = require('node:path')

const IGNORED_EXECUTABLES = new Set([
  'chrome-sandbox',
  'chrome_crashpad_handler',
  'crashpad_handler'
])
const WRAPPER_FLAGS = '--no-sandbox --disable-setuid-sandbox'
const WRAPPER_HEAD_MAX_BYTES = 512

async function pathExists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function readFileHead(filePath, maxBytes = WRAPPER_HEAD_MAX_BYTES) {
  const fileHandle = await fs.open(filePath, 'r')
  try {
    const buffer = Buffer.alloc(maxBytes)
    const { bytesRead } = await fileHandle.read(buffer, 0, maxBytes, 0)
    return buffer.toString('utf8', 0, bytesRead)
  } finally {
    await fileHandle.close()
  }
}

async function isWrapperAlreadyPresent(executablePath, originalBinaryPath) {
  if (!(await pathExists(originalBinaryPath))) {
    return false
  }

  try {
    const currentHead = await readFileHead(executablePath)
    return (
      currentHead.startsWith('#!/bin/sh') &&
      currentHead.includes(path.basename(originalBinaryPath)) &&
      currentHead.includes('--no-sandbox') &&
      currentHead.includes('--disable-setuid-sandbox')
    )
  } catch {
    return false
  }
}

async function findExecutableCandidate(appOutDir, preferredName) {
  const preferredPath = preferredName ? path.join(appOutDir, preferredName) : null
  if (preferredPath && (await pathExists(preferredPath))) {
    return preferredPath
  }

  const entries = await fs.readdir(appOutDir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isFile() && !entry.isSymbolicLink()) {
      continue
    }
    if (IGNORED_EXECUTABLES.has(entry.name) || entry.name.endsWith('.so') || entry.name.endsWith('.pak')) {
      continue
    }
    const fullPath = path.join(appOutDir, entry.name)
    const stat = await fs.stat(fullPath)
    if ((stat.mode & 0o111) === 0) {
      continue
    }
    return fullPath
  }

  return null
}

async function addLinuxNoSandboxWrapper(context) {
  if (context.electronPlatformName !== 'linux') {
    return
  }

  const appOutDir = context.appOutDir
  const executablePath = await findExecutableCandidate(appOutDir, context?.packager?.executableName)
  if (!executablePath) {
    throw new Error(`afterPack linux wrapper: unable to find executable in ${appOutDir}`)
  }
  const originalBinaryPath = `${executablePath}.bin`

  // Idempotent hook in case multiple linux targets are produced from same appOutDir.
  const wrapperAlreadyPresent = await isWrapperAlreadyPresent(executablePath, originalBinaryPath)
  if (wrapperAlreadyPresent) {
    return
  }

  if (!(await pathExists(originalBinaryPath))) {
    await fs.rename(executablePath, originalBinaryPath)
  }

  const wrapper = `#!/bin/sh
HERE="$(dirname "$(readlink -f "$0")")"
exec "$HERE/${path.basename(originalBinaryPath)}" ${WRAPPER_FLAGS} "$@"
`
  await fs.writeFile(executablePath, wrapper, { mode: 0o755 })
}

module.exports = addLinuxNoSandboxWrapper
module.exports.default = addLinuxNoSandboxWrapper
