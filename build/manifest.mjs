import fs, { readFileSync } from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import crypto from 'node:crypto'
import yaml from 'js-yaml'
import { fileURLToPath } from 'node:url'

/**
 * Release manifest generator.
 *
 * This script runs after the platform build artifacts have been downloaded into
 * releases/. It creates the CLI archives, removes builder-only outputs, reads
 * the electron-updater latest*.yml files, and writes releases/latest.json.
 *
 * latest.json keeps the existing client-facing platform index and now also
 * includes a deployment manifest for the server-side sync script:
 *
 * {
 *   "version": "2.1.1",
 *   "date": "2026-07-11T13:39:42.696Z",
 *   "platform": {
 *     "linux": [{ "package": "...", "arch": "...", "ext": "...", "sha512": "...", "size": 0, "url": "..." }],
 *     "mac": [],
 *     "win": [],
 *     "node": []
 *   },
 *   "files": [
 *     { "asset": "Sync-in-Desktop-2.1.1-x64.exe", "path": "sync-in-desktop/win/Sync-in-Desktop-2.1.1-x64.exe", "size": 0, "sha512": "...", "url": "..." }
 *   ]
 * }
 *
 * The files[] entries map flat GitHub Release asset names to their relative
 * destination paths under releases.sync-in.org, with size and sha512 used for
 * deployment verification.
 */

// constants
const __filename = fileURLToPath(import.meta.url)
const appPath = path.dirname(path.dirname(__filename))
const packageJsonPath = path.join(appPath, 'package.json')
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'))
const packageVersion = packageJson.version
const updatesURL = packageJson.build.publish[0].url.split('/$')[0]
const appName = 'sync-in-desktop'
const cliName = 'sync-in-cli'
const releasePath = path.join(appPath, 'releases')
const latestJSON = 'latest.json'
const releaseCliPath = path.join(releasePath, cliName)
const releaseAppPath = path.join(releasePath, appName)
const releaseCliFileName = `${cliName}-${packageVersion}.js`
const releaseCliFilePath = path.join(releaseCliPath, releaseCliFileName)
const regExpCleanUp = new RegExp('builder.*.ya?ml$|unpacked$|mac/mac.*|.icon-.*')
const regExpMatchLatestYML = new RegExp('^latest.*.yml$')
const latestApp = { platform: { linux: [], mac: [], win: [], node: [] }, version: packageVersion, date: '', files: [] }

function sha512Base64(filePath) {
  return crypto.createHash('sha512').update(fs.readFileSync(filePath)).digest('base64')
}

function toPosixPath(filePath) {
  return filePath.split(path.sep).join('/')
}

function releaseRelativePath(filePath) {
  const relativePath = path.relative(releasePath, filePath)
  const segments = relativePath.split(path.sep)
  if (!relativePath || path.isAbsolute(relativePath) || segments.includes('..')) {
    throw new Error(`Release file is outside release root: ${filePath}`)
  }
  return toPosixPath(relativePath)
}

async function genCliLatest() {
  console.log(`Creating manifests for ${cliName} ...`)
  const releaseCliFileZip = `${releaseCliFilePath}.zip`
  const releaseCmdFileTarGZ = `${releaseCliFilePath}.tar.gz`
  if (fs.existsSync(releaseCliFilePath)) {
    execSync(`cd ${releaseCliPath} && zip ${releaseCliFileZip} ${releaseCliFileName} && tar zcf ${releaseCmdFileTarGZ} ${releaseCliFileName}`)
    fs.rmSync(releaseCliFilePath)
  }
  for (const archive of [releaseCliFileZip, releaseCmdFileTarGZ]) {
    const extension = archive.split(releaseCliFilePath).join('').substring(1).toLowerCase()
    const stats = fs.lstatSync(archive)
    latestApp.platform.node.push({
      package: path.basename(archive),
      ext: extension,
      date: stats.ctime,
      size: stats.size,
      sha512: sha512Base64(archive),
      url: `${updatesURL}/${cliName}/${path.basename(archive)}`
    })
  }
}

function parseDirs(dir) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const realPath = path.resolve(dir, f.name)
    const isDir = f.isDirectory()
    if (regExpCleanUp.test(realPath)) {
      console.log(`cleanup ${isDir ? 'directory' : 'file'}: ${f.name}`)
      fs.rmSync(realPath, { recursive: isDir, force: true })
      continue
    }
    if (isDir) {
      parseDirs(realPath)
    }
    if (regExpMatchLatestYML.test(f.name)) {
      const os = f.name === 'latest.yml' ? 'win' : f.name.includes('linux') ? 'linux' : 'mac'
      const latestContent = yaml.load(fs.readFileSync(realPath))
      if (!latestApp.date) {
        latestApp.date = latestContent.releaseDate
      }
      for (const f of latestContent.files) {
        const arch = f.url.split('-').splice(-1)[0].split('.')[0]
        let ext = f.url.split('.').splice(-1)[0]
        if (os === 'mac' && ext === 'zip') {
          continue
        }
        if (os === 'win') {
          ext = 'Setup'
        }
        latestApp.platform[os].push({
          package: f.url,
          arch: arch,
          ext: ext,
          sha512: f.sha512,
          size: f.size,
          url: `${updatesURL}/${appName}/${os}/${f.url}`
        })
      }
    }
  }
}

async function genDesktopLatest() {
  console.log(`Creating manifests for ${appName} ...`)
  parseDirs(releaseAppPath)
}

function collectDeployFiles(dir = releasePath, assetNames = new Set()) {
  const files = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const realPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectDeployFiles(realPath, assetNames))
      continue
    }
    if (!entry.isFile() || entry.name === latestJSON) {
      continue
    }

    const asset = path.basename(realPath)
    if (assetNames.has(asset)) {
      throw new Error(`Duplicate GitHub release asset name: ${asset}`)
    }
    assetNames.add(asset)

    const deployPath = releaseRelativePath(realPath)
    const stats = fs.lstatSync(realPath)
    files.push({
      asset,
      path: deployPath,
      size: stats.size,
      sha512: sha512Base64(realPath),
      url: `${updatesURL}/${deployPath}`
    })
  }
  return files
}

async function start() {
  for (const p of [releasePath, releaseCliPath, releaseAppPath]) {
    if (!fs.existsSync(p)) {
      throw `${p} does not exist`
    }
  }
  await Promise.all([genCliLatest(), genDesktopLatest()])
  latestApp.files = collectDeployFiles()
  fs.writeFileSync(path.join(releasePath, latestJSON), JSON.stringify(latestApp))
}

start().then(() => console.log(`Manifest created for version ${packageVersion}: ${path.join(releasePath, latestJSON)} !`))
