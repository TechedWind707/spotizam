#!/usr/bin/env bash
set -euo pipefail

IS_WSL=false
if grep -qi microsoft /proc/version 2>/dev/null; then
  IS_WSL=true
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_EXTENSION="${1:-$SCRIPT_DIR/spotizam.js}"
SOURCE_APP_DIR="$SCRIPT_DIR/spotizam"

if [ ! -f "$SOURCE_EXTENSION" ]; then
  echo "Source extension file not found: $SOURCE_EXTENSION" >&2
  exit 2
fi

if [ ! -d "$SOURCE_APP_DIR" ]; then
  echo "Optional custom app folder not found: $SOURCE_APP_DIR" >&2
fi

SPICETIFY_BASE=""
SPICETIFY_EXT_DIR=""
SPICETIFY_APP_DIR=""
SPICETIFY_CMD=()

detect_spicetify_base() {
  if command -v spicetify >/dev/null 2>&1; then
    local userdata
    userdata=$(spicetify path userdata 2>/dev/null || true)
    if [ -n "$userdata" ]; then
      SPICETIFY_BASE="$userdata"
      return
    fi
  fi

  if [ "$IS_WSL" = true ]; then
    if command -v cmd.exe >/dev/null 2>&1; then
      local windows_appdata
      windows_appdata=$(cmd.exe /c echo %APPDATA% 2>/dev/null | tr -d '\r' || echo "") || true
      if [ -n "$windows_appdata" ] && [ "$windows_appdata" != "%APPDATA%" ]; then
        SPICETIFY_BASE="$(wslpath -u "$windows_appdata")/spicetify"
        return
      fi
    fi
    SPICETIFY_BASE="/mnt/c/Users/$(cmd.exe /c echo %USERNAME% 2>/dev/null | tr -d '\r' || echo "spiri")/AppData/Roaming/spicetify"
    return
  fi

  case "${OSTYPE:-}" in
    darwin*)
      if [ -n "${SPICETIFY_CONFIG:-}" ]; then
        SPICETIFY_BASE="$SPICETIFY_CONFIG"
      elif [ -d "$HOME/spicetify_data" ] || [ ! -e "$HOME/spicetify_data" ]; then
        SPICETIFY_BASE="$HOME/spicetify_data"
      else
        SPICETIFY_BASE="$HOME/.config/spicetify"
      fi
      ;;
    msys*|cygwin*|win32*)
      if [ -d "$APPDATA/spicetify" ] || [ ! -e "$APPDATA/spicetify" ]; then
        SPICETIFY_BASE="$APPDATA/spicetify"
      else
        SPICETIFY_BASE="$USERPROFILE/.spicetify"
      fi
      ;;
    *)
      SPICETIFY_BASE="$HOME/.config/spicetify"
      ;;
  esac
}

detect_spicetify_base
SPICETIFY_EXT_DIR="$SPICETIFY_BASE/Extensions"
SPICETIFY_APP_DIR="$SPICETIFY_BASE/CustomApps"

if [ "$IS_WSL" = false ]; then
  if command -v spicetify >/dev/null 2>&1; then
    SPICETIFY_CMD=(spicetify)
  elif command -v spicetify.exe >/dev/null 2>&1; then
    SPICETIFY_CMD=(spicetify.exe)
  fi
fi

prompt_custom_app_install() {
  if [ ! -d "$SOURCE_APP_DIR" ]; then
    echo "Custom app source folder not found; skipping optional app install."
    return 1
  fi

  printf "Do you want to install the optional Spotizam custom app for grouped results/history? [Y/N]: "
  read -r reply
  case "${reply:-}" in
    y|Y|yes|YES)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

copy_custom_app=false
if prompt_custom_app_install; then
  copy_custom_app=true
fi

mkdir -p "$SPICETIFY_EXT_DIR"
cp -f -- "$SOURCE_EXTENSION" "$SPICETIFY_EXT_DIR/spotizam.js"
echo "Copied extension: $SOURCE_EXTENSION -> $SPICETIFY_EXT_DIR/spotizam.js"

if [ "$copy_custom_app" = true ]; then
  mkdir -p "$SPICETIFY_APP_DIR"
  rm -rf "$SPICETIFY_APP_DIR/spotizam"
  cp -R -- "$SOURCE_APP_DIR" "$SPICETIFY_APP_DIR/spotizam"
  echo "Copied custom app: $SOURCE_APP_DIR -> $SPICETIFY_APP_DIR/spotizam"
fi

if [ "$IS_WSL" = true ]; then
  echo ""
  echo "=== WSL: Files copied successfully ==="
  echo "Extension: $SPICETIFY_EXT_DIR/spotizam.js"
  if [ "$copy_custom_app" = true ]; then
    echo "Custom app: $SPICETIFY_APP_DIR/spotizam"
  fi
  echo ""
  echo "Run these commands in PowerShell or Git Bash (not WSL):"
  echo "  spicetify config extensions spotizam.js"
  if [ "$copy_custom_app" = true ]; then
    echo "  spicetify config custom_apps spotizam"
  fi
  echo "  spicetify apply"
  exit 0
fi

if [ "${#SPICETIFY_CMD[@]}" -eq 0 ]; then
  echo "spicetify not found in PATH. Install Spicetify or run manually:" >&2
  echo "  spicetify config extensions spotizam.js" >&2
  if [ "$copy_custom_app" = true ]; then
    echo "  spicetify config custom_apps spotizam" >&2
  fi
  echo "  spicetify apply" >&2
  exit 3
fi

is_spotify_running() {
  case "${OSTYPE:-}" in
    darwin*)
      pgrep -x Spotify >/dev/null 2>&1
      ;;
    msys*|cygwin*|win32*)
      tasklist.exe 2>/dev/null | grep -i Spotify >/dev/null 2>&1
      ;;
    *)
      pgrep -x spotify >/dev/null 2>&1 || pgrep -f spotify >/dev/null 2>&1
      ;;
  esac
}

if is_spotify_running; then
  echo "Spotify is running. Close Spotify and re-run this script so Spicetify can apply the changes." >&2
  exit 0
fi

if ! "${SPICETIFY_CMD[@]}" config extensions 2>/dev/null | grep -Eq '(^|[[:space:]])spotizam\.js($|[[:space:]])'; then
  "${SPICETIFY_CMD[@]}" config extensions spotizam.js
fi

if [ "$copy_custom_app" = true ]; then
  if ! "${SPICETIFY_CMD[@]}" config custom_apps 2>/dev/null | grep -Eq '(^|[[:space:]])spotizam($|[[:space:]])'; then
    "${SPICETIFY_CMD[@]}" config custom_apps spotizam
  fi
fi

echo "Applying Spicetify..."
if "${SPICETIFY_CMD[@]}" apply; then
  echo "Done. Spotizam extension installed."
  if [ "$copy_custom_app" = true ]; then
    echo "Spotizam custom app installed too."
  else
    echo "Custom app skipped. You can add it later by copying the 'spotizam' folder into CustomApps and registering it."
  fi
else
  echo "spicetify apply failed. Run 'spicetify apply' manually for details." >&2
  exit 4
fi
