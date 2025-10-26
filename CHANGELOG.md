
## [1.5.0](https://git.sync-in.org/sync-in/desktop/compare/v1.4.0...v1.5.0) (2025-10-26)

### Highlights

* 🌍 **14 languages supported** — added 12 new ones: 🇩🇪 🇪🇸 🇵🇹 🇧🇷 🇮🇹 🇨🇳 🇮🇳 🇹🇷 🇯🇵 🇰🇷 🇵🇱 🇷🇺

### Features

* **i18n:** add Japanese, Brazilian Portuguese, Polish, Korean, and Turkish translations ([443b898](https://git.sync-in.org/sync-in/desktop/commit/443b898515bd8d255fd7edc0379c8f7155242ffb))
* **i18n:** add Russian translations ([82b941d](https://git.sync-in.org/sync-in/desktop/commit/82b941d4ba0bfff5c7fabdee4575d7d627f5a250))
* **i18n:** add support for multiple languages and optimize unused translation keys detection ([85e527c](https://git.sync-in.org/sync-in/desktop/commit/85e527cdf2371d90a88527676981130ecbe72a73))
* **i18n:** enhance i18n setup with dynamic translation loading and locale resolution ([a07d8c6](https://git.sync-in.org/sync-in/desktop/commit/a07d8c6c68c74c5adfbd7dd2fda9b1321563f032))
* **i18n:** modularize localization setup and extend language support ([8d5eac6](https://git.sync-in.org/sync-in/desktop/commit/8d5eac64f8c30c56e83490e3eb64d53829b84e56))
* **i18n:** refactor i18n manager and add language normalization logic ([04fb872](https://git.sync-in.org/sync-in/desktop/commit/04fb872037da70a0a9eeafc71d0a0fcf6b24ae84))

## [1.4.0](https://git.sync-in.org/sync-in/desktop/compare/v1.3.0...v1.4.0) (2025-09-26)


### Features

* **auth:** add support for MFA authentication ([544ec08](https://git.sync-in.org/sync-in/desktop/commit/544ec08fc77a4577f81f9a49d2beed853d034a09))
* **main:** open external URLs in the user's browser instead of inside the app ([f3dda3d](https://git.sync-in.org/sync-in/desktop/commit/f3dda3db5e32fcd198208a12aa4454577b0e55ea))

## [1.3.0](https://git.sync-in.org/sync-in/desktop/compare/v1.2.9...v1.3.0) (2025-09-06)


### Features

* **main:** add options to launch app at login and to start hidden ([286a4e1](https://git.sync-in.org/sync-in/desktop/commit/286a4e1cf6ccbe32dfc0703a2925fbeca9aaa993))


### Bug Fixes

* **core:** prevent infinite loop when adding unreachable server ([baeca22](https://git.sync-in.org/sync-in/desktop/commit/baeca22ceeec42c6f09d5562e47e7b8189988443))
* **main:** apply zoomFactor to active BrowserView only ([228adb7](https://git.sync-in.org/sync-in/desktop/commit/228adb75ff92db6800ad8fa4333ca721d96d498c))
* **main:** avoid wrong notification on canceled downloads ([38df616](https://git.sync-in.org/sync-in/desktop/commit/38df6168bdf62eebd4b4bbe883254b81783b7825))
* **main:** correct webview overflow by snapping bounds to display scale ([7eac291](https://git.sync-in.org/sync-in/desktop/commit/7eac2914846db25684bd5e1aca9e467a4f3433fc))
* **main:** force webView.webContents.setZoomFactor(1) ([4db872d](https://git.sync-in.org/sync-in/desktop/commit/4db872d5f6090d9bf926e85f21f4606f33cb2f39))
* **main:** stop intercepting system Ctrl/Cmd+arrow keys globally ([7e01470](https://git.sync-in.org/sync-in/desktop/commit/7e01470baf5f4541c7c6b5506d5cccdfe64912e5))
* **main:** webView.webContents.setZoomFactor(1) only works after loading content ([4ae21ba](https://git.sync-in.org/sync-in/desktop/commit/4ae21ba8d36a2c595a04b5bee220e2fecbe76c0d))
* **renderer:** correct server dropdown position ([4aa1f82](https://git.sync-in.org/sync-in/desktop/commit/4aa1f821b9b09b84c295d579a0a119a0a30c632d))
