#!/usr/bin/env bash
set -euo pipefail

print_usage() {
  cat <<'USAGE'
Usage: install-spotizam.sh [path/to/spotizam.js]

If no source path is provided, you'll be prompted to paste/drag the file path.
The script copies the file to your Spicetify Extensions folder, ensures the
extension is registered, and runs `spicetify apply` if Spotify is not running.
If Spotify is running, the script will ask you to close the client and re-run.
USAGE
}

SOURCE=${1-}
if [ -z "$SOURCE" ]; then
  read -rp $'Enter full path to spotizam.js (or drag file here):\n' SOURCE
fi

if [ -z "$SOURCE" ]; then
  echo "No source provided." >&2
  print_usage
  exit 2
fi

if [ ! -f "$SOURCE" ]; then
  echo "Source file not found: $SOURCE" >&2
  exit 2
fi

# Resolve spicetify userdata path, fallback to conventional location
SPICETIFY_DIR=""
if command -v spicetify >/dev/null 2>&1; then
  SPICETIFY_DIR=$(spicetify path userdata 2>/dev/null || true)
fi
if [ -z "$SPICETIFY_DIR" ]; then
  # fallback
  SPICETIFY_DIR="$HOME/.config/spicetify"
fi

EXT_DIR="$SPICETIFY_DIR/Extensions"
mkdir -p "$EXT_DIR"

DEST="$EXT_DIR/spotizam.js"
cp -f -- "$SOURCE" "$DEST"
echo "Copied: $SOURCE -> $DEST"

# Detect Spotify running
is_spotify_running() {
  if [[ "$OSTYPE" == "darwin"* ]]; then
    pgrep -x Spotify >/dev/null 2>&1
  else
    pgrep -x spotify >/dev/null 2>&1 || pgrep -f spotify >/dev/null 2>&1
  fi
}

if is_spotify_running; then
  echo "Spotify appears to be running. Please close the Spotify client and re-run this script to apply the extension." >&2
  exit 0
fi

if ! command -v spicetify >/dev/null 2>&1; then
  echo "spicetify not found in PATH. Please install Spicetify or run the following commands manually after closing Spotify:" >&2
  echo "  spicetify config extensions spotizam.js"
  echo "  spicetify apply"
  exit 3
fi

# Register the extension if not already present
if ! spicetify config extensions 2>/dev/null | grep -q "spotizam.js"; then
  spicetify config extensions spotizam.js
fi

echo "Applying Spicetify..."
if spicetify apply; then
  echo "spicetify apply completed successfully." 
else
  echo "spicetify apply failed. Run 'spicetify apply' manually for details." >&2
  exit 4
fi

echo "Done. You can now start Spotify."