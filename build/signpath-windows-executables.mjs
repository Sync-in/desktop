import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { BlobReader, BlobWriter, ZipReader, ZipWriter, configure } from '@zip.js/zip.js'

configure({ useWebWorkers: false })

const __filename = fileURLToPath(import.meta.url)
const appPath = path.dirname(path.dirname(__filename))
const releaseRoot = resolveFromApp(process.env.RELEASE_ROOT ?? 'releases/sync-in-desktop')
const releaseWin = path.join(releaseRoot, 'win')
const archive = path.join(appPath, 'signpath-windows-apps.zip')
const signedRoot = path.join(appPath, 'signed-windows-apps')
const expanded = path.join(appPath, 'signed-windows-apps-expanded')
const unsignedUninstallers = path.join(appPath, 'nsis-uninstallers', 'unsigned')
const signedUninstallers = path.join(appPath, 'nsis-uninstallers', 'signed')
const bundles = ['win-unpacked', 'win-arm64-unpacked']
const arches = ['x64', 'arm64']

function resolveFromApp(filePath) {
  return path.isAbsolute(filePath) ? filePath : path.join(appPath, filePath)
}

function assertDirectory(dirPath, message) {
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    throw new Error(message)
  }
}

function assertFile(filePath, message) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(message)
  }
}

function walkFiles(dirPath) {
  const files = []
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const entryPath = path.join(dirPath, entry.name)
    if (entry.isDirectory()) {
      files.push(...walkFiles(entryPath))
    } else if (entry.isFile()) {
      files.push(entryPath)
    }
  }
  return files
}

function listExecutables(dirPath) {
  return walkFiles(dirPath)
    .filter((filePath) => path.extname(filePath).toLowerCase() === '.exe')
    .sort((a, b) => a.localeCompare(b))
}

function relativeArchivePath(root, filePath) {
  const relativePath = path.relative(root, filePath)
  const segments = relativePath.split(path.sep)
  if (!relativePath || path.isAbsolute(relativePath) || segments.includes('..')) {
    throw new Error(`Path is outside expected root: ${filePath}`)
  }
  return segments.join('/')
}

async function createZip(entries) {
  const zipWriter = new ZipWriter(new BlobWriter('application/zip'))
  let closed = false
  try {
    for (const entry of entries.sort((a, b) => a.archivePath.localeCompare(b.archivePath))) {
      const content = await fs.promises.readFile(entry.filePath)
      await zipWriter.add(entry.archivePath, new BlobReader(new Blob([content])))
    }
    const blob = await zipWriter.close()
    closed = true
    await fs.promises.writeFile(archive, Buffer.from(await blob.arrayBuffer()))
  } finally {
    if (!closed) {
      await zipWriter.close().catch(() => undefined)
    }
  }
}

async function stage() {
  fs.rmSync(archive, { force: true })

  const archiveEntries = []

  for (const bundle of bundles) {
    const source = path.join(releaseWin, bundle)
    assertDirectory(source, `Missing unsigned Windows app bundle: ${source}`)
    assertFile(path.join(source, 'resources', 'app-update.yml'), `Missing Windows app update config before SignPath upload: ${source}`)

    const sourceRoot = fs.realpathSync(source)
    const executables = listExecutables(sourceRoot)
    if (executables.length === 0) {
      throw new Error(`No Windows app executable found for SignPath upload in: ${source}`)
    }

    for (const filePath of executables) {
      const archivePath = `${bundle}/${relativeArchivePath(sourceRoot, filePath)}`
      archiveEntries.push({ archivePath, filePath })
    }
  }

  for (const arch of arches) {
    const uninstallerName = `${arch}__uninstaller.exe`
    const source = path.join(unsignedUninstallers, uninstallerName)
    assertFile(source, `Missing captured NSIS uninstaller: ${source}`)

    const archivePath = `uninstallers/${uninstallerName}`
    archiveEntries.push({ archivePath, filePath: source })
  }

  await createZip(archiveEntries)
  console.log(`Staged ${archiveEntries.length} Windows executable(s) for SignPath: ${archive}`)
}

function findSignedArchive() {
  assertDirectory(signedRoot, `Missing signed Windows output directory: ${signedRoot}`)
  const archives = walkFiles(signedRoot).filter((filePath) => path.extname(filePath).toLowerCase() === '.zip')
  if (archives.length !== 1) {
    throw new Error(`SignPath returned ${archives.length} signed Windows executable archive(s), expected 1.`)
  }
  return archives[0]
}

function extractEntryPath(root, fileName) {
  const normalized = path.posix.normalize(fileName.replaceAll('\\', '/'))
  const segments = normalized.split('/')
  if (!normalized || normalized === '.' || normalized.includes('\0') || path.posix.isAbsolute(normalized) || segments.includes('..')) {
    throw new Error(`Unsafe zip entry path returned by SignPath: ${fileName}`)
  }

  const destination = path.join(root, ...segments)
  const relativeDestination = path.relative(root, destination)
  if (relativeDestination.startsWith('..') || path.isAbsolute(relativeDestination)) {
    throw new Error(`Unsafe zip extraction destination returned by SignPath: ${fileName}`)
  }

  return destination
}

async function extractZipArchive(zipPath, destinationRoot) {
  const content = await fs.promises.readFile(zipPath)
  const zipReader = new ZipReader(new BlobReader(new Blob([content])))
  try {
    const entries = await zipReader.getEntries()
    for (const entry of entries) {
      if (entry.directory) {
        continue
      }

      const destination = extractEntryPath(destinationRoot, entry.filename)
      fs.mkdirSync(path.dirname(destination), { recursive: true })
      const blob = await entry.getData(new BlobWriter())
      await fs.promises.writeFile(destination, Buffer.from(await blob.arrayBuffer()))
    }
  } finally {
    await zipReader.close()
  }
}

function replaceBundleExecutables(bundle) {
  const bundlePath = path.join(releaseWin, bundle)
  const signedBundle = path.join(expanded, bundle)
  assertDirectory(bundlePath, `Missing Windows app bundle before SignPath replacement: ${bundlePath}`)
  assertDirectory(signedBundle, `Could not find signed Windows app bundle returned by SignPath: ${bundle}`)

  const bundleRoot = fs.realpathSync(bundlePath)
  const signedBundleRoot = fs.realpathSync(signedBundle)
  const expectedFiles = listExecutables(bundleRoot)
  const signedFiles = listExecutables(signedBundleRoot)

  if (expectedFiles.length === 0) {
    throw new Error(`No Windows app executable found before SignPath replacement in: ${bundlePath}`)
  }
  if (signedFiles.length !== expectedFiles.length) {
    throw new Error(`SignPath returned ${signedFiles.length} executable(s) for ${bundle}, expected ${expectedFiles.length}.`)
  }

  const expectedByRelativePath = new Map()
  for (const filePath of expectedFiles) {
    expectedByRelativePath.set(relativeArchivePath(bundleRoot, filePath), filePath)
  }

  for (const filePath of signedFiles) {
    const archivePath = relativeArchivePath(signedBundleRoot, filePath)
    const destination = expectedByRelativePath.get(archivePath)
    if (!destination) {
      throw new Error(`Signed Windows executable ${bundle}/${archivePath} does not match an expected bundle executable.`)
    }

    fs.copyFileSync(filePath, destination)
    expectedByRelativePath.delete(archivePath)
  }

  if (expectedByRelativePath.size !== 0) {
    throw new Error(`SignPath did not return every expected executable for ${bundle}.`)
  }
}

async function replace() {
  const signedArchive = findSignedArchive()

  fs.rmSync(expanded, { recursive: true, force: true })
  fs.mkdirSync(expanded, { recursive: true })
  await extractZipArchive(signedArchive, expanded)

  for (const bundle of bundles) {
    replaceBundleExecutables(bundle)
  }

  fs.rmSync(signedUninstallers, { recursive: true, force: true })
  fs.mkdirSync(signedUninstallers, { recursive: true })
  for (const arch of arches) {
    const uninstallerName = `${arch}__uninstaller.exe`
    const source = path.join(expanded, 'uninstallers', uninstallerName)
    assertFile(source, `Missing signed NSIS uninstaller returned by SignPath: ${source}`)
    fs.copyFileSync(source, path.join(signedUninstallers, uninstallerName))
  }

  console.log(`Replaced signed Windows bundle executable(s) from SignPath: ${signedArchive}`)
}

async function start() {
  const mode = process.argv[2]
  if (mode === 'stage') {
    await stage()
  } else if (mode === 'replace') {
    await replace()
  } else {
    throw new Error('Usage: node build/signpath-windows-executables.mjs <stage|replace>')
  }
}

start().catch((error) => {
  console.error(`::error::${error.message}`)
  process.exit(1)
})
