/**
 * electron-builder signing hook for the generated NSIS uninstaller.
 *
 * In capture mode it saves the unsigned uninstaller for external SignPath
 * signing; in inject mode it replaces the regenerated uninstaller with the
 * signed one and writes a receipt for the release workflow.
 */
const { createHash } = require('node:crypto')
const { createReadStream } = require('node:fs')
const { copyFile, mkdir, readFile, writeFile } = require('node:fs/promises')
const path = require('node:path')

const MODE_ENV = 'SYNC_IN_NSIS_UNINSTALLER_MODE'
const FILE_ENV = 'SYNC_IN_NSIS_UNINSTALLER_FILE'
const METADATA_ENV = 'SYNC_IN_NSIS_UNINSTALLER_METADATA'
const RECEIPT_ENV = 'SYNC_IN_NSIS_UNINSTALLER_RECEIPT'

async function sha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath)

    stream.on('error', reject)
    hash.on('error', reject)
    hash.on('finish', () => resolve(hash.digest('hex')))
    stream.pipe(hash)
  })
}

async function sign(configuration) {
  const generatedFile = configuration.path
  if (!generatedFile.endsWith('__uninstaller.exe')) {
    return
  }
  if (configuration.hash !== 'sha256') {
    throw new Error(`Unsupported NSIS uninstaller signing hash: ${configuration.hash}`)
  }

  const mode = process.env[MODE_ENV]
  const uninstallerFile = process.env[FILE_ENV]
  const metadataFile = process.env[METADATA_ENV]
  if (!mode || !uninstallerFile || !metadataFile) {
    throw new Error(`Missing ${MODE_ENV}, ${FILE_ENV}, or ${METADATA_ENV}`)
  }

  if (mode === 'capture') {
    await mkdir(path.dirname(uninstallerFile), { recursive: true })
    await mkdir(path.dirname(metadataFile), { recursive: true })
    await copyFile(generatedFile, uninstallerFile)

    const unsignedSha256 = await sha256(uninstallerFile)
    await writeFile(metadataFile, JSON.stringify({ unsignedSha256 }, null, 2))
    console.log(`[nsis-uninstaller] Captured ${uninstallerFile} (${unsignedSha256})`)
    return
  }

  if (mode === 'inject') {
    const receiptFile = process.env[RECEIPT_ENV]
    if (!receiptFile) {
      throw new Error(`Missing ${RECEIPT_ENV}`)
    }

    const metadata = JSON.parse(String(await readFile(metadataFile, 'utf8')))
    const generatedSha256 = await sha256(generatedFile)
    const matchesCaptured = generatedSha256 === metadata.unsignedSha256

    await copyFile(uninstallerFile, generatedFile)
    const signedSha256 = await sha256(generatedFile)
    if (signedSha256 === metadata.unsignedSha256) {
      throw new Error('The NSIS uninstaller returned by SignPath is unchanged')
    }

    await mkdir(path.dirname(receiptFile), { recursive: true })
    await writeFile(
      receiptFile,
      JSON.stringify(
        {
          capturedUnsignedSha256: metadata.unsignedSha256,
          generatedSha256,
          matchesCaptured,
          signedSha256
        },
        null,
        2
      )
    )
    if (!matchesCaptured) {
      console.log(`[nsis-uninstaller] Regenerated uninstaller differs after app signing: ` + `${generatedSha256} != ${metadata.unsignedSha256}`)
    }
    console.log(`[nsis-uninstaller] Injected signed uninstaller ${uninstallerFile}`)
    return
  }

  throw new Error(`Unsupported ${MODE_ENV}: ${mode}`)
}

module.exports = sign
