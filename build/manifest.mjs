/*
 * Copyright (C) 2012-2025 Johan Legrand <johan.legrand@sync-in.com>
 * This file is part of Sync-in | The open source file sync and share solution
 * See the LICENSE file for licensing details
 */

// modules
import fs, { readFileSync } from 'node:fs'
import { writeFile } from 'fs/promises'
import path from 'node:path'
import { execSync } from 'node:child_process'
import crypto from 'node:crypto'
import yaml from 'js-yaml'
import { fileURLToPath } from 'node:url' // constants

// constants
const __filename = fileURLToPath(import.meta.url)
const appPath = path.dirname(path.dirname(__filename))
const packageJsonPath = path.join(appPath, 'package.json')
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'))
const packageVersion = packageJson.version
const updatesURL = packageJson.build.publish[0].url.split('/$')[0]
const appName = 'sync-in-desktop'
const cliName = 'sync-in-cli'
const serverName = 'sync-in-server'
const releasePath = path.join(appPath, 'releases')
const latestJSON = 'latest.json'
const releaseCliPath = path.join(releasePath, cliName)
const releaseAppPath = path.join(releasePath, appName)
const releaseServerPath = path.join(releasePath, serverName)
const releaseCliFileName = `${cliName}-${packageVersion}.js`
const releaseCliFilePath = path.join(releaseCliPath, releaseCliFileName)
const regExpCleanUp = new RegExp('builder.*.ya?ml$|unpacked$|mac/mac.*|.icon-.*')
const regExpMatchLatestYML = new RegExp('^latest.*.yml$')
const latestApp = { platform: { linux: [], mac: [], win: [], node: [] }, version: packageVersion, date: '' }

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
      sha512: crypto.createHash('sha512').update(fs.readFileSync(archive)).digest('base64'),
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

async function getServerLatest() {
  console.log(`Creating manifests for ${serverName} ...`)
  try {
    const url = `https://api.github.com/repos/sync-in/server/releases/latest`
    const response = await fetch(url)
    const latestContent = await response.json()
    const latestReleasePath = `${releaseServerPath}/latest.json`
    await writeFile(latestReleasePath, JSON.stringify(latestContent, null, 2))
  } catch (e) {
    console.error(`unable to retrieve last server release : ${e}`)
    process.exit(1)
  }
}

async function start() {
  fs.mkdirSync(releaseServerPath, { recursive: true })
  for (const p of [releasePath, releaseCliPath, releaseAppPath, releaseServerPath]) {
    if (!fs.existsSync(p)) {
      throw `${p} does not exist`
    }
  }
  await Promise.all([genCliLatest(), genDesktopLatest(), getServerLatest()])
  fs.writeFileSync(path.join(releasePath, latestJSON), JSON.stringify(latestApp))
}

start().then(() => console.log(`Manifest created for version ${packageVersion}: ${path.join(releasePath, latestJSON)} !`))
