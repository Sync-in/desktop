/*
 * Copyright (C) 2012-2025 Johan Legrand <johan.legrand@sync-in.com>
 * This file is part of Sync-in | The open source file sync and share solution
 * See the LICENSE file for licensing details
 */
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

export default [
  {
    mode: isProduction ? 'production' : 'development',
    devtool: isProduction ? undefined : 'inline-source-map',
    name: 'app',
    target: 'electron-main',
    entry: {
      main: path.join(__dirname, 'main', 'main.ts'),
      preload: path.join(__dirname, 'main', 'preload.ts')
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
      })
    ],
    resolve: { extensions: ['.ts', '.js'] },
    output: {
      path: path.resolve(__dirname, 'dist', 'main')
    }
  },
  {
    mode: isProduction ? 'production' : 'development',
    devtool: isProduction ? undefined : 'inline-source-map',
    name: 'cli',
    target: 'node',
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
      new ShebangPlugin()
    ],
    resolve: { extensions: ['.ts', '.js'] },
    output: {
      path: path.resolve(__dirname, 'releases', 'sync-in-cli'),
      filename: `sync-in-cli-${version}.js`
    },
    ignoreWarnings: [{ module: /yargs/ }]
  }
]
