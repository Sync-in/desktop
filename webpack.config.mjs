import path from 'node:path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import TerserPlugin from 'terser-webpack-plugin'
import ESLintWebpackPlugin from 'eslint-webpack-plugin'
import CopyPlugin from 'copy-webpack-plugin'
import ShebangPlugin from 'webpack-shebang-plugin'
import pkg from './package.json' with { type: 'json' }
import ForkTsCheckerWebpackPlugin from 'fork-ts-checker-webpack-plugin'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const version = pkg.version
const isProduction = process.env.NODE_ENV !== 'development'
const preloadAsset = /^preload-.*\.cjs(?:\.map)?$/

class WarningsAsErrorsPlugin {
  apply(compiler) {
    compiler.hooks.shouldEmit.tap('WarningsAsErrorsPlugin', (compilation) => {
      const warnings = compilation.getWarnings()
      if (!warnings.length) return
      compilation.errors.push(...warnings)
      compilation.warnings.length = 0
      return false
    })
  }
}

export default [
  {
    mode: isProduction ? 'production' : 'development',
    devtool: isProduction ? undefined : 'inline-source-map',
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
            loader: 'swc-loader',
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
        new TerserPlugin({
          terserOptions: {
            format: {
              comments: false
            }
          },
          extractComments: false
        })
      ]
    },
    plugins: [
      new ForkTsCheckerWebpackPlugin({ async: !isProduction }),
      new CopyPlugin({
        patterns: [
          {
            from: './main/assets',
            to: 'assets'
          },
          {
            from: './i18n/*.json',
            to: ''
          }
        ]
      }),
      new ESLintWebpackPlugin({
        failOnError: isProduction,
        extensions: ['ts'],
        files: ['main/**', 'core/**'],
        exclude: ['node_modules', path.resolve(__dirname, 'renderer'), path.resolve(__dirname, 'cli')]
      }),
      ...(!isProduction ? [new WarningsAsErrorsPlugin()] : [])
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
        keep: preloadAsset
      }
    }
  },
  {
    mode: isProduction ? 'production' : 'development',
    devtool: isProduction ? undefined : 'inline-source-map',
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
            loader: 'swc-loader',
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
        new TerserPlugin({
          terserOptions: {
            format: {
              comments: false
            }
          },
          extractComments: false
        })
      ]
    },
    plugins: [...(!isProduction ? [new WarningsAsErrorsPlugin()] : [])],
    resolve: { extensions: ['.ts', '.js'] },
    output: {
      path: path.resolve(__dirname, 'dist', 'main'),
      filename: '[name].cjs',
      module: false,
      chunkFormat: 'commonjs',
      chunkLoading: false,
      asyncChunks: false,
      clean: {
        keep: (asset) => !preloadAsset.test(asset)
      }
    }
  },
  {
    mode: isProduction ? 'production' : 'development',
    devtool: isProduction ? undefined : 'inline-source-map',
    name: 'cli',
    target: 'node22.12',
    entry: path.join(__dirname, 'cli', 'main.ts'),
    module: {
      rules: [
        {
          test: /\.ts$/,
          exclude: /node_modules/,
          use: {
            loader: 'swc-loader',
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
        new TerserPlugin({
          terserOptions: {
            format: {
              comments: false
            }
          },
          extractComments: false
        })
      ]
    },
    plugins: [
      new ForkTsCheckerWebpackPlugin({ async: !isProduction }),
      new ESLintWebpackPlugin({
        failOnError: isProduction,
        files: ['cli/**', 'core/**'],
        extensions: ['ts'],
        exclude: ['node_modules', path.resolve(__dirname, 'renderer'), path.resolve(__dirname, 'main')]
      }),
      new ShebangPlugin({ shebangRegExp: /^(#![^\r\n]*)[\r\n]*/ }),
      ...(!isProduction ? [new WarningsAsErrorsPlugin()] : [])
    ],
    resolve: { extensions: ['.ts', '.js'] },
    output: {
      path: path.resolve(__dirname, 'releases'),
      filename: `sync-in-cli/sync-in-cli-${version}.js`,
      module: true,
      chunkFormat: 'module',
      chunkLoading: 'import',
      asyncChunks: false,
      clean: isProduction
    }
  }
]
