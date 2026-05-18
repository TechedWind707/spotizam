# Changelog

## Unreleased

### Added

- optional `spotizam` custom app for grouped results/history browsing
- grouped search-batch history model shared by extension and custom app
- grouped latest result UI in the extension settings panel
- grouped search history UI in the extension settings panel
- batch delete and clear-history behavior for grouped search history

### Changed

- flattened the settings panel by removing the old `Advanced` wrapper
- `History size` now means recent **search batches**, not flat songs
- `Open results page after recognition` now targets the real custom app route
- renamed the custom app folder/route target from `spotizam` to `spotizam-app` to keep it distinct from the repo/extension name
- action order now prioritizes primary actions like opening in Spotify and playback before secondary actions
- install flow now supports extension-first installation with optional custom app setup

### Fixed

- migrated old flat history data into grouped search batches on load
- removed the old fake extension-owned results page path that could lead to blank pages
