# Spotizam

`Spotizam` is a Spicetify music recognizer built as:

- a required **extension** for mic capture, provider calls, settings, and saved data
- an optional **custom app** for a fuller results/history page

It is designed for two common workflows:

- quickly identify a song and jump straight into Spotify
- sing or play something, then review the grouped results before choosing what to open

## Features

- mic button and settings gear in Spotify
- `ACRCloud` and `AudD` provider support
- grouped latest results
- grouped history by **search batch**, not just flat songs
- optional custom app results page
- optional debug audio saving
- optional debug JSON saving

## Supported Providers

### ACRCloud (Recommended)

- best option when you want support for both real audio and humming
- default provider in Spotizam
- requires:
  - `Host`
  - `Access Key`
  - `Access Secret`
- signup:
  - <https://console.acrcloud.com/>

### AudD

- simpler setup
- good when you are playing the real audio clearly
- usually worse than ACRCloud for humming
- requires:
  - `API Token`
- signup:
  - <https://audd.io>

## Installation

### Option A - Install Script

Clone the repo and run:

#### Bash

```bash
git clone https://github.com/TechedWind707/spotizam
cd spotizam
bash install.sh
```

#### PowerShell

```powershell
git clone https://github.com/TechedWind707/spotizam
cd spotizam
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

The script now does this:

1. installs the `spotizam.js` extension
2. asks whether you also want the optional `spotizam` custom app
3. registers the selected Spicetify entries
4. runs `spicetify apply` when Spotify is closed

The extension is the base install. The custom app is optional.

### Option B - Manual Setup

#### Extension

1. Put [spotizam.js](./spotizam.js) in your Spicetify `Extensions` folder.

   Hint:
   this folder is usually something like:

   ```text
   %APPDATA%\spicetify\Extensions
   ```

2. Register it:

   ```bash
   spicetify config extensions spotizam.js
   ```

#### Optional custom app

1. Put the whole [spotizam](./spotizam) folder in your Spicetify `CustomApps` folder:

   ```text
   %APPDATA%\spicetify\CustomApps
   ```

2. Register it:

   ```bash
   spicetify config custom_apps spotizam
   ```

#### Apply

Close Spotify, then run:

```bash
spicetify apply
```

Restart Spotify after that.

If the mic or gear button does not appear right away, try:

```text
Ctrl+Shift+R
```

inside Spotify.

## Permissions

The first time you use Spotizam, Spotify will ask for microphone permission.

If you enable:

- debug audio saving
- debug JSON saving
- folder selection for either one

Spotify or the browser runtime may also ask for folder access permission.

## How Spotizam Is Structured

### Extension

The extension handles:

- mic capture
- provider requests
- quick settings
- grouped result storage
- post-match behavior
- opening the optional custom app

### Custom app

The optional custom app handles:

- fuller latest result browsing
- grouped search history browsing
- per-result Spotify actions in a larger UI

Both surfaces read from the same local storage config.

## Where Settings Are Stored

Spotizam stores its settings in:

```text
localStorage["spotizam_config"]
```

The current saved shape is roughly:

```json
{
  "provider": "acrcloud",
  "recordingSeconds": 15,
  "afterMatch": {
    "openSong": true,
    "playSong": false
  },
  "resultsPage": {
    "openAfterRecognition": true
  },
  "history": {
    "enabled": false,
    "maxItems": 5,
    "includeAllMatches": false,
    "searches": [
      {
        "id": "search-...",
        "timestamp": "2026-05-17T00:00:00.000Z",
        "provider": "acrcloud",
        "service": "ACRCloud",
        "query": "Arise Don Moen",
        "items": [
          {
            "title": "Arise",
            "artist": "Don Moen",
            "spotifyUri": "spotify:track:...",
            "spotifyAlbumId": null,
            "searchQuery": "Arise Don Moen",
            "service": "ACRCloud",
            "timestamp": "2026-05-17T00:00:00.000Z",
            "confidence": 0.96,
            "isPrimary": true
          }
        ]
      }
    ]
  },
  "latestResults": {
    "id": "search-...",
    "timestamp": "2026-05-17T00:00:00.000Z",
    "provider": "acrcloud",
    "service": "ACRCloud",
    "query": "Arise Don Moen",
    "items": []
  },
  "debug": {
    "keepAudio": false,
    "audioDirectory": "",
    "keepJson": false,
    "jsonDirectory": ""
  },
  "acrcloud": {
    "host": "",
    "accessKey": "",
    "accessSecret": ""
  },
  "audd": {
    "apiToken": ""
  }
}
```

## How To Use It

1. Click the gear icon next to the mic.
2. Choose your provider.
3. Enter your credentials.
4. Pick recording length and post-match behavior.
5. Choose whether Spotizam should open the custom app results page after recognition.
6. Click `Save`.
7. Click the mic to recognize a song or a hummed melody.

## Settings Explained

### Recognition Provider

Choose one of:

- `ACRCloud`
- `AudD`

Only the selected provider is used when you click the mic.

### Recording Length

- minimum: `15` seconds
- maximum: `30` seconds

Behavior:

- Spotizam always records at least `15` seconds
- if your limit is above `15`, you can click the mic again after `15` seconds to stop early

### After Match

Controls:

- `Open song page`
- `Start playing immediately`
- `Open results page after recognition`

Behavior:

- if `Open results page after recognition` is enabled, it becomes the main navigation mode
- in that mode, direct post-match navigation options are disabled
- if it is off, `Open song page` and `Start playing immediately` work normally

### History

Controls:

- `Enable recognition history`
- `History size`
- `Include all provider matches when available`

Behavior:

- history is stored as recent **search batches**
- one search can contain one or many returned songs
- `History size` means how many recent search batches to keep
- `Include all provider matches` stores all candidates returned by the provider, not just the best one

### Latest Result and History UI

Inside the extension panel:

- `Latest Result` shows the best match first
- if more than one match came back, you can expand to show the rest
- `History` is grouped by search batch
- grouped searches show timestamp, provider/service, result count, and top match
- each result prioritizes prime actions like opening in Spotify and playback before secondary actions like search/copy

Inside the custom app:

- the same grouped model is shown in a larger browsing surface

### Debug Audio

- `Keep copy of recorded audio`
- choose a folder for the current Spotify session

If folder picking is unavailable, Spotizam falls back to a normal download.

### Debug JSON

- `Keep copy of returned JSON`
- choose a folder for the current Spotify session

If folder picking is unavailable, Spotizam falls back to a normal download.

## Button States

### Idle

- mic icon is visible

### Recording

- mic glows red
- before `15` seconds, clicking again does not stop recording
- after `15` seconds, clicking again stops early

### Processing

- spinner appears
- tooltip shows which provider is being used

### Match

- green check icon

### Error

- red X icon

## Debug Logging

Spotizam intentionally logs useful information with a `[spotizam]` prefix.

Examples:

- extension load
- settings save
- recording start / stop
- provider request start
- raw provider response payload
- whether a Spotify URI came from the provider directly or from fallback search
- after-match behavior decisions

## ACRCloud Setup Guide

1. Go to <https://console.acrcloud.com/>
2. Create an account and sign in
3. Create a project under `Projects -> Audio & Video Recognition`
4. Recommended choices:
   - `Audio Source`: `Recorded Audio`
   - engine with normal recognition + humming support
   - enable Spotify in third-party integrations if available
5. Copy:
   - `Host`
   - `Access Key`
   - `Secret Key`
6. Paste them into Spotizam settings and save

## Troubleshooting

### Mic or gear is missing

Try:

```text
Ctrl+Shift+R
```

inside Spotify.

### Custom app route opens but looks empty

Check:

- the `spotizam` folder is really inside `%APPDATA%\spicetify\CustomApps`
- `spicetify config custom_apps spotizam` has been run
- `spicetify apply` was run after that

### Provider says no match

Check:

- your mic recording quality
- whether you selected the provider you intended
- the provider payload in console logs

### ACRCloud says `invalid signature`

Double-check:

- `Host`
- `Access Key`
- `Access Secret`

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).
