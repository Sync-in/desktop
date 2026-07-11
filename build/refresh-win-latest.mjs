/**
 * Refresh Windows updater metadata after installers have been signed.
 *
 * Recreates installer blockmaps, validates their size and sha512 metadata
 * against the signed .exe files, and rewrites latest.yml for electron-updater.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const require = createRequire(import.meta.url)
const { executeAppBuilderAsJson } = require('app-builder-lib/out/util/appBuilder')
const appPath = path.dirname(path.dirname(__filename))
const packageJson = JSON.parse(fs.readFileSync(path.join(appPath, 'package.json'), 'utf8'))
const releaseDir = path.resolve(appPath, process.argv[2] ?? 'releases/sync-in-desktop/win')
const archOrder = new Map([
  ['x64', 0],
  ['arm64', 1]
])

function sha512Base64(filePath) {
  return crypto.createHash('sha512').update(fs.readFileSync(filePath)).digest('base64')
}

function detectArch(fileName) {
  const match = fileName.match(/-(x64|arm64)\.exe$/)
  return match?.[1] ?? fileName
}

function yamlQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

function removeStaleBlockmaps() {
  for (const fileName of fs.readdirSync(releaseDir)) {
    if (fileName.endsWith('.blockmap')) {
      fs.rmSync(path.join(releaseDir, fileName))
    }
  }
}

async function createInstallerBlockmap(filePath) {
  const blockMapFile = `${filePath}.blockmap`
  const updateInfo = await executeAppBuilderAsJson(['blockmap', '--input', filePath, '--output', blockMapFile])

  if (!fs.existsSync(blockMapFile) || !fs.statSync(blockMapFile).isFile() || fs.statSync(blockMapFile).size === 0) {
    throw new Error(`Windows installer blockmap was not generated: ${blockMapFile}`)
  }

  return updateInfo
}

async function buildInstallerInfo(fileName) {
  const filePath = path.join(releaseDir, fileName)
  const updateInfo = await createInstallerBlockmap(filePath)
  const stats = fs.statSync(filePath)
  const sha512 = sha512Base64(filePath)

  if (updateInfo.sha512 && updateInfo.sha512 !== sha512) {
    throw new Error(`Generated blockmap metadata sha512 does not match signed installer: ${fileName}`)
  }

  if (updateInfo.size && updateInfo.size !== stats.size) {
    throw new Error(`Generated blockmap metadata size does not match signed installer: ${fileName}`)
  }

  return {
    fileName,
    sha512,
    size: stats.size,
    blockMapSize: updateInfo.blockMapSize
  }
}

async function start() {
  if (!fs.existsSync(releaseDir)) {
    throw new Error(`Windows release directory not found: ${releaseDir}`)
  }

  removeStaleBlockmaps()

  const installerFileNames = fs
    .readdirSync(releaseDir)
    .filter((fileName) => fileName.endsWith('.exe'))
    .sort((a, b) => {
      const aArch = detectArch(a)
      const bArch = detectArch(b)
      return (archOrder.get(aArch) ?? 99) - (archOrder.get(bArch) ?? 99) || a.localeCompare(b)
    })

  if (installerFileNames.length === 0) {
    throw new Error(`No Windows installer found in ${releaseDir}`)
  }

  const installers = []
  for (const fileName of installerFileNames) {
    installers.push(await buildInstallerInfo(fileName))
  }

  const primaryInstaller = installers[0]
  const latestYml = [
    `version: ${packageJson.version}`,
    'files:',
    ...installers.flatMap((installer) => {
      const lines = [`  - url: ${installer.fileName}`, `    sha512: ${installer.sha512}`, `    size: ${installer.size}`]
      if (installer.blockMapSize) {
        lines.push(`    blockMapSize: ${installer.blockMapSize}`)
      }
      return lines
    }),
    `path: ${primaryInstaller.fileName}`,
    `sha512: ${primaryInstaller.sha512}`,
    `releaseDate: ${yamlQuote(new Date().toISOString())}`,
    ''
  ].join('\n')

  fs.writeFileSync(path.join(releaseDir, 'latest.yml'), latestYml)
  console.log(`Windows latest.yml and blockmap(s) refreshed for ${installers.length} signed installer(s).`)
}

start().catch((error) => {
  console.error(`::error::${error.message}`)
  process.exit(1)
})
