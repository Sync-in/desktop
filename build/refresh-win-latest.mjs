import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
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

if (!fs.existsSync(releaseDir)) {
  throw new Error(`Windows release directory not found: ${releaseDir}`)
}

for (const fileName of fs.readdirSync(releaseDir)) {
  if (fileName.endsWith('.blockmap')) {
    fs.rmSync(path.join(releaseDir, fileName))
  }
}

const installers = fs
  .readdirSync(releaseDir)
  .filter((fileName) => fileName.endsWith('.exe'))
  .sort((a, b) => {
    const aArch = detectArch(a)
    const bArch = detectArch(b)
    return (archOrder.get(aArch) ?? 99) - (archOrder.get(bArch) ?? 99) || a.localeCompare(b)
  })
  .map((fileName) => {
    const filePath = path.join(releaseDir, fileName)
    const stats = fs.statSync(filePath)
    return {
      fileName,
      sha512: sha512Base64(filePath),
      size: stats.size
    }
  })

if (installers.length === 0) {
  throw new Error(`No Windows installer found in ${releaseDir}`)
}

const primaryInstaller = installers[0]
const latestYml = [
  `version: ${packageJson.version}`,
  'files:',
  ...installers.flatMap((installer) => [
    `  - url: ${installer.fileName}`,
    `    sha512: ${installer.sha512}`,
    `    size: ${installer.size}`
  ]),
  `path: ${primaryInstaller.fileName}`,
  `sha512: ${primaryInstaller.sha512}`,
  `releaseDate: ${yamlQuote(new Date().toISOString())}`,
  ''
].join('\n')

fs.writeFileSync(path.join(releaseDir, 'latest.yml'), latestYml)
console.log(`Windows latest.yml refreshed for ${installers.length} signed installer(s).`)
