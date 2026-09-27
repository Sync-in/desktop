import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileFunction } from 'node:vm'
import { build } from 'esbuild'
import { describe, test } from 'vitest'
import { DIFF_MODE, SIDE_STATE, SYNC_MODE } from '../constants/diff'
import type { SyncFileStats } from '../interfaces/sync-diff.interface'
import type { DiffParser } from './diff'
import type { FilesParser } from './parser'

// Bundle the code under measurement in memory so Vite's module-runner getters do not skew timings.
const benchFile = fileURLToPath(import.meta.url)
const { outputFiles } = await build({
  stdin: {
    contents: `
      export { DiffParser } from './diff'
      export { SyncPath } from '../models/syncpath'
      export { NormalizedMap } from '../utils/normalizedMap'
    `,
    resolveDir: path.dirname(benchFile),
    sourcefile: 'diff-bench-entry.ts',
    loader: 'ts'
  },
  bundle: true,
  format: 'cjs',
  platform: 'node',
  packages: 'external',
  target: 'node22',
  write: false
})
const bundledModule = { exports: {} as Record<string, unknown> }
const loadBundle = compileFunction(outputFiles[0].text, ['require', 'module', 'exports', '__filename', '__dirname'], { filename: benchFile })
loadBundle(createRequire(benchFile), bundledModule, bundledModule.exports, benchFile, path.dirname(benchFile))
const BenchDiffParser = bundledModule.exports.DiffParser as typeof import('./diff').DiffParser
const BenchSyncPath = bundledModule.exports.SyncPath as typeof import('../models/syncpath').SyncPath
const BenchNormalizedMap = bundledModule.exports.NormalizedMap as typeof import('../utils/normalizedMap').NormalizedMap

function stats(size: number, ino: number, isDir = false, checksum: string | null = null): SyncFileStats {
  return [isDir, size, 10, ino, checksum]
}

function createDiff(
  local: [string, SyncFileStats][],
  remote: [string, SyncFileStats][],
  oldLocal: [string, SyncFileStats][] = [],
  oldRemote: [string, SyncFileStats][] = [],
  firstSync = false,
  diffMode = DIFF_MODE.FAST
): DiffParser {
  const syncPath = new BenchSyncPath({
    id: 7,
    name: 'Benchmark',
    localPath: '/local/benchmark',
    remotePath: 'PERSONAL/benchmark',
    permissions: 'add:modify:delete',
    mode: SYNC_MODE.UPLOAD,
    diffMode,
    firstSync,
    filters: []
  })
  const parser = {
    req: { server: { id: 1, identity: () => ({ id: 1, name: 'benchmark' }) } },
    curSnap: {
      local: new BenchNormalizedMap<string, SyncFileStats>(local),
      remote: new BenchNormalizedMap<string, SyncFileStats>(remote)
    },
    oldSnap: {
      local: new BenchNormalizedMap<string, SyncFileStats>(oldLocal),
      remote: new BenchNormalizedMap<string, SyncFileStats>(oldRemote)
    }
  } as unknown as FilesParser
  const diff = new BenchDiffParser(syncPath, parser)
  Object.assign(diff, {
    logger: {
      debug: () => undefined,
      error: (error: unknown) => {
        throw error
      }
    }
  })
  return diff
}

async function collectActions(diff: DiffParser) {
  const actions: [string, unknown[]][] = []
  for await (const [state, values] of diff.run()) {
    actions.push([state, values])
  }
  return actions
}

const unchanged = Array.from({ length: 10_000 }, (_, index) => [`file-${index}`, stats(100 + index, index + 1)] as [string, SyncFileStats])
const movedOld = Array.from({ length: 300 }, (_, index) => [`old/file-${index}`, stats(100 + index, index + 1)] as [string, SyncFileStats])
const movedNew = movedOld.map(([filePath, fileStats]) => [filePath.replace('old/', 'new/'), fileStats] as [string, SyncFileStats])
const directories = Array.from({ length: 2_000 }, (_, index) => [`directory-${index}`, stats(0, index + 1, true)] as [string, SyncFileStats])
const nestedOld: [string, SyncFileStats][] = [
  ['a', stats(0, 1, true)],
  ['a/foo', stats(100, 2)]
]
const nestedNew: [string, SyncFileStats][] = [
  ['b', nestedOld[0][1]],
  ['b/bar', nestedOld[1][1]]
]
const copySource: [string, SyncFileStats] = ['source.txt', stats(100, 1, false, 'same')]
const copies = Array.from({ length: 2_000 }, (_, index) => [`copy-${index}.txt`, stats(100, index + 2, false, 'same')] as [string, SyncFileStats])

const cases = [
  {
    name: '10,000 unchanged files',
    diff: createDiff(unchanged, unchanged),
    expectedCount: 0,
    expectedDigest: '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945',
    expectedActions: null
  },
  {
    name: '300 independent moves',
    diff: createDiff(movedNew, movedOld, movedOld, movedOld),
    expectedCount: 300,
    expectedDigest: '5ca85b3662ed5ca58f178ce4f688245c1b97d3dfb6f6be9e4dd315bb36d02f57',
    expectedActions: null
  },
  {
    name: '2,000 directories to create',
    diff: createDiff(directories, [], [], [], true),
    expectedCount: 2_000,
    expectedDigest: '29da084da5c1006641847769c8e2c87acf68d6a1d21e98eedd2b8dad9bb4d16e',
    expectedActions: null
  },
  {
    name: 'nested move',
    diff: createDiff(nestedNew, nestedOld, nestedOld, nestedOld),
    expectedCount: 2,
    expectedDigest: null,
    expectedActions: [
      [
        SIDE_STATE.REMOTE_MOVE,
        [
          { src: 'a/foo', dst: 'a/bar' },
          { src: 'a', dst: 'b' }
        ]
      ]
    ]
  },
  {
    name: '2,000 checksum copies',
    diff: createDiff([copySource, ...copies], [copySource], [], [], true, DIFF_MODE.SECURE),
    expectedCount: 2_000,
    expectedState: SIDE_STATE.REMOTE_COPY,
    expectedDigest: null,
    expectedActions: null
  }
]

describe('DiffParser', () => {
  for (const fixture of cases) {
    test(fixture.name, async ({ bench }) => {
      let reported = false
      await bench(fixture.name, async () => {
        const actions = await collectActions(fixture.diff)
        const count = actions.reduce((total, [, values]) => total + values.length, 0)
        if (count !== fixture.expectedCount) {
          throw new Error(`${fixture.name}: ${count} actions instead of ${fixture.expectedCount}`)
        }
        if ('expectedState' in fixture && (actions.length !== 1 || actions[0][0] !== fixture.expectedState)) {
          throw new Error(`${fixture.name}: expected only ${fixture.expectedState} actions`)
        }
        if (!reported) {
          if (fixture.expectedActions && JSON.stringify(actions) !== JSON.stringify(fixture.expectedActions)) {
            throw new Error(`${fixture.name}: unexpected action order or paths`)
          }
          const digest = createHash('sha256').update(JSON.stringify(actions)).digest('hex')
          if (fixture.expectedDigest && digest !== fixture.expectedDigest) {
            throw new Error(`${fixture.name}: actions differ from the pre-optimization baseline`)
          }
          console.log(`${fixture.name}: ${count} actions, SHA-256 ${digest}`)
          reported = true
        }
      }).run({ warmupTime: 100, warmupIterations: 2, time: 1_000, iterations: 5 })
    })
  }
})
