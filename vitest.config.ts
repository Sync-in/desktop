import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { configDefaults, defineConfig } from 'vitest/config'

const rootDir = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@sync-in-desktop/cli': path.resolve(rootDir, 'cli'),
      '@sync-in-desktop/core': path.resolve(rootDir, 'core'),
      '@sync-in-desktop/main': path.resolve(rootDir, 'main')
    }
  },
  test: {
    clearMocks: true,
    environment: 'node',
    exclude: [...configDefaults.exclude, 'dist/**', 'releases/**', 'renderer/**'],
    globals: false,
    include: [
      'build/**/*.{test,spec}.{js,mjs,ts}',
      'cli/**/*.{test,spec}.ts',
      'core/**/*.{test,spec}.ts',
      'main/**/*.{test,spec}.ts',
      'tests/**/*.{test,spec}.ts'
    ],
    passWithNoTests: true,
    restoreMocks: true,
    typecheck: {
      checker: 'tsc',
      enabled: true,
      tsconfig: 'tsconfig.json'
    }
  }
})
