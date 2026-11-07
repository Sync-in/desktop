import { chmodSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { rspack } from '@rspack/core'
import ESLintRspackPlugin from 'eslint-rspack-plugin'
import { TsCheckerRspackPlugin } from 'ts-checker-rspack-plugin'
import pkg from './package.json' with { type: 'json' }

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const isProduction = process.env.NODE_ENV !== 'development'
const preloadAsset = /^preload-.*\.cjs(?:\.map)?$/
const isPreloadAsset = (asset) => preloadAsset.test(path.basename(asset))
const cliAsset = `sync-in-cli/sync-in-cli-${pkg.version}.js`

function warningToError(warning) {
  const error = new rspack.WebpackError(warning.message)
  for (const property of ['name', 'stack', 'details', 'module', 'loc', 'file', 'chunk', 'hideStack']) {
    if (warning[property] !== undefined) error[property] = warning[property]
  }
  return error
}

class WarningsAsErrorsPlugin {
  apply(compiler) {
    compiler.hooks.shouldEmit.tap('WarningsAsErrorsPlugin', (compilation) => {
      if (!compilation.warnings.length) return
      const warnings = compilation.warnings.splice(0)
      compilation.errors.push(...warnings.map(warningToError))
      return false
    })
  }
}

class CliExecutablePlugin {
  apply(compiler) {
    compiler.hooks.afterEmit.tap('CliExecutablePlugin', (compilation) => {
      if (process.platform === 'win32' || !compilation.getAsset(cliAsset)) return
      chmodSync(path.resolve(compiler.options.output.path, cliAsset), 0o755)
    })
  }
}

export default [
  {
    mode: isProduction ? 'production' : 'development',
    devtool: isProduction ? undefined : 'inline-source-map',
    stats: {
      preset: 'normal',
      assets: true,
      modules: true,
      entrypoints: 'auto'
    },
    name: 'app',
    target: 'electron43-main',
    entry: {
      main: path.join(__dirname, 'main', 'main.ts')
    },
    module: {
      rules: [
        {
          test: /\.ts$/,
          include: [path.resolve(__dirname, 'main'), path.resolve(__dirname, 'core'), path.resolve(__dirname, 'i18n')],
          exclude: /node_modules/,
          use: {
            loader: 'builtin:swc-loader',
            options: {
              jsc: { parser: { syntax: 'typescript' }, target: 'es2022' }
            }
          }
        }
      ]
    },
    optimization: {
      minimize: true,
      minimizer: [
        new rspack.SwcJsMinimizerRspackPlugin({
          extractComments: false,
          minimizerOptions: { format: { comments: false } }
        })
      ]
    },
    plugins: [
      new TsCheckerRspackPlugin({ async: !isProduction }),
      new rspack.CopyRspackPlugin({
        patterns: [
          {
            from: path.resolve(__dirname, 'main/assets'),
            to: 'assets'
          },
          {
            from: '*.json',
            context: path.resolve(__dirname, 'i18n'),
            to: 'i18n'
          }
        ]
      }),
      new ESLintRspackPlugin({
        files: ['main/**/*.ts', 'core/**/*.ts'],
        lintAllFiles: true,
        severity: { error: isProduction ? 'error' : 'warning' }
      }),
      new rspack.ProgressPlugin({ prefix: 'app' }),
      new WarningsAsErrorsPlugin()
    ],
    resolve: { extensions: ['.ts', '.js'] },
    output: {
      path: path.resolve(__dirname, 'dist', 'main'),
      filename: '[name].js',
      chunkFilename: '[name].js',
      module: true,
      chunkFormat: 'module',
      chunkLoading: 'import',
      clean: {
        keep: isPreloadAsset
      }
    }
  },
  {
    mode: isProduction ? 'production' : 'development',
    devtool: isProduction ? undefined : 'inline-source-map',
    stats: {
      preset: 'normal',
      assets: true,
      modules: true,
      entrypoints: 'auto'
    },
    name: 'preloads',
    target: 'electron43-preload',
    entry: {
      'preload-wrapper': path.join(__dirname, 'main', 'preload-wrapper.ts'),
      'preload-webview': path.join(__dirname, 'main', 'preload-webview.ts')
    },
    module: {
      rules: [
        {
          test: /\.ts$/,
          include: path.resolve(__dirname, 'main'),
          exclude: /node_modules/,
          use: {
            loader: 'builtin:swc-loader',
            options: {
              jsc: { parser: { syntax: 'typescript' }, target: 'es2022' }
            }
          }
        }
      ]
    },
    optimization: {
      minimize: true,
      splitChunks: false,
      runtimeChunk: false,
      minimizer: [
        new rspack.SwcJsMinimizerRspackPlugin({
          extractComments: false,
          minimizerOptions: { format: { comments: false } }
        })
      ]
    },
    plugins: [new rspack.ProgressPlugin({ prefix: 'preloads' }), new WarningsAsErrorsPlugin()],
    resolve: { extensions: ['.ts', '.js'] },
    output: {
      path: path.resolve(__dirname, 'dist', 'main'),
      filename: '[name].cjs',
      module: false,
      chunkFormat: 'commonjs',
      chunkLoading: false,
      asyncChunks: false,
      clean: {
        keep: (asset) => !isPreloadAsset(asset)
      }
    }
  },
  {
    mode: isProduction ? 'production' : 'development',
    devtool: isProduction ? undefined : 'inline-source-map',
    stats: {
      preset: 'normal',
      assets: true,
      modules: true,
      entrypoints: 'auto'
    },
    name: 'cli',
    target: 'node22.12',
    entry: path.join(__dirname, 'cli', 'main.ts'),
    module: {
      rules: [
        {
          test: /\.ts$/,
          exclude: /node_modules/,
          use: {
            loader: 'builtin:swc-loader',
            options: {
              jsc: { parser: { syntax: 'typescript' }, target: 'es2022' }
            }
          }
        }
      ]
    },
    optimization: {
      minimize: true,
      splitChunks: false,
      runtimeChunk: false,
      minimizer: [
        new rspack.SwcJsMinimizerRspackPlugin({
          extractComments: false,
          minimizerOptions: { format: { comments: false } }
        })
      ]
    },
    plugins: [
      new TsCheckerRspackPlugin({ async: !isProduction }),
      new ESLintRspackPlugin({
        files: ['cli/**/*.ts', 'core/**/*.ts'],
        lintAllFiles: true,
        severity: { error: isProduction ? 'error' : 'warning' }
      }),
      new rspack.BannerPlugin({
        banner: '#!/usr/bin/env node',
        raw: true,
        entryOnly: true,
        include: /sync-in-cli-.*\.js$/
      }),
      new CliExecutablePlugin(),
      new rspack.ProgressPlugin({ prefix: 'cli' }),
      new WarningsAsErrorsPlugin()
    ],
    resolve: { extensions: ['.ts', '.js'] },
    output: {
      path: path.resolve(__dirname, 'releases'),
      filename: cliAsset,
      module: true,
      chunkFormat: 'module',
      chunkLoading: 'import',
      asyncChunks: false,
      clean: isProduction
    }
  }
]
