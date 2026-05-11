#!/usr/bin/env bash
set -euo pipefail

IS_WSL=false
if grep -qi microsoft /proc/version 2>/dev/null; then
  IS_WSL=true
fi

# Source defaults to spotizam.js in the same directory as this script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE="${1:-$SCRIPT_DIR/spotizam.js}"

if [ ! -f "$SOURCE" ]; then
  echo "Source file not found: $SOURCE" >&2
  exit 2
fi

# Find Spicetify Extensions directory
SPICETIFY_EXT_DIR=""
SPICETIFY_CMD=()

# Try using spicetify command first (most reliable)
if command -v spicetify >/dev/null 2>&1; then
  USERDATA=$(spicetify path userdata 2>/dev/null || true)
  if [ -n "$USERDATA" ]; then
    SPICETIFY_EXT_DIR="$USERDATA/Extensions"
  fi
fi

if [ -z "$SPICETIFY_EXT_DIR" ] && [ "$IS_WSL" = true ]; then
  # Try cmd.exe to get Windows APPDATA
  if command -v cmd.exe >/dev/null 2>&1; then
    WINDOWS_APPDATA=$(cmd.exe /c echo %APPDATA% 2>/dev/null | tr -d '\r' || echo "") || true
    if [ -n "$WINDOWS_APPDATA" ] && [ "$WINDOWS_APPDATA" != "%APPDATA%" ]; then
      SPICETIFY_EXT_DIR="$(wslpath -u "$WINDOWS_APPDATA")/spicetify/Extensions" 2>/dev/null || true
    fi
  fi
  # Fallback: construct Windows path directly via WSL mount if cmd.exe failed
  if [ -z "$SPICETIFY_EXT_DIR" ]; then
    SPICETIFY_EXT_DIR="/mnt/c/Users/$(cmd.exe /c echo %USERNAME% 2>/dev/null | tr -d '\r' || echo "spiri")/AppData/Roaming/spicetify/Extensions"
  fi
fi

# If spicetify command didn't work, check OS-specific paths
if [ -z "$SPICETIFY_EXT_DIR" ]; then
  if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS: try primary paths first, then fallback
    if [ -n "${SPICETIFY_CONFIG:-}" ]; then
      SPICETIFY_EXT_DIR="$SPICETIFY_CONFIG/Extensions"
    elif [ -d "$HOME/spicetify_data/Extensions" ] || [ ! -e "$HOME/spicetify_data" ]; then
      SPICETIFY_EXT_DIR="$HOME/spicetify_data/Extensions"
    else
      SPICETIFY_EXT_DIR="$HOME/.config/spicetify/Extensions"
    fi
  elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" || "$OSTYPE" == "win32" ]]; then
    # Windows: try primary first, then alternative
    if [ -d "$APPDATA/spicetify/Extensions" ] || [ ! -e "$APPDATA/spicetify" ]; then
      SPICETIFY_EXT_DIR="$APPDATA/spicetify/Extensions"
    else
      SPICETIFY_EXT_DIR="$USERPROFILE/.spicetify/Extensions"
    fi
  else
    # Linux and others
    SPICETIFY_EXT_DIR="$HOME/.config/spicetify/Extensions"
  fi
fi

if [ "$IS_WSL" = true ]; then
  # WSL can copy files but cannot execute Windows .exe files directly.
  # After copying, print instructions for the user to apply from Windows.
  echo ""
  echo "=== WSL: File copied successfully! ===" >&2
  echo "spotizam.js is now in: /mnt/c/Users/spiri/AppData/Roaming/spicetify/Extensions/" >&2
  echo ""
  echo "To apply the extension, run these commands in PowerShell or Git Bash (not WSL):" >&2
  echo "  spicetify config extensions spotizam.js" >&2
  echo "  spicetify apply" >&2
  echo ""
  echo "Or close Spotify and re-run this script from Git Bash or run the install.ps1 instead." >&2
  exit 0
else
  if command -v spicetify >/dev/null 2>&1; then
    SPICETIFY_CMD=(spicetify)
  elif command -v spicetify.exe >/dev/null 2>&1; then
    SPICETIFY_CMD=(spicetify.exe)
  fi
fi

EXT_DIR="$SPICETIFY_EXT_DIR"
mkdir -p "$EXT_DIR"

DEST="$EXT_DIR/spotizam.js"
cp -f -- "$SOURCE" "$DEST"
echo "Copied: $SOURCE -> $DEST"

# Detect Spotify running
is_spotify_running() {
  if [ "$IS_WSL" = true ]; then
    if command -v tasklist.exe >/dev/null 2>&1; then
      tasklist.exe 2>/dev/null | grep -i Spotify >/dev/null 2>&1
    elif command -v powershell.exe >/dev/null 2>&1; then
      powershell.exe -NoProfile -Command "Get-Process Spotify -ErrorAction SilentlyContinue | Out-Null" >/dev/null 2>&1
    else
      return 1
    fi
  elif [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    pgrep -x Spotify >/dev/null 2>&1
  elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" || "$OSTYPE" == "win32" ]]; then
    # Windows
    tasklist.exe 2>/dev/null | grep -i Spotify >/dev/null 2>&1
  else
    # Linux
    pgrep -x spotify >/dev/null 2>&1 || pgrep -f spotify >/dev/null 2>&1
  fi
}

if is_spotify_running; then
  echo "Spotify is running. Please close Spotify and re-run this script to apply the changes." >&2
  exit 0
fi

# Check if spicetify is available in PATH
if [ "${#SPICETIFY_CMD[@]}" -eq 0 ]; then
  echo "spicetify not found in PATH. Install Spicetify or manually run:" >&2
  echo "  spicetify config extensions spotizam.js" >&2
  echo "  spicetify apply" >&2
  exit 3
fi

# Register the extension if not already present
if ! "${SPICETIFY_CMD[@]}" config extensions 2>/dev/null | grep -q "spotizam.js"; then
  "${SPICETIFY_CMD[@]}" config extensions spotizam.js
fi

echo "Applying Spicetify..."
if "${SPICETIFY_CMD[@]}" apply; then
  echo "spicetify apply completed successfully." 
  echo "Done. You can now start Spotify."
else
  echo "spicetify apply failed. Run 'spicetify apply' manually for details." >&2
  exit 4
fi
