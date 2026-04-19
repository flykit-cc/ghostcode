#!/bin/zsh
# Detached helper: waits for Ghostty to exit, re-applies the icon,
# refreshes Dock/Finder caches, then reopens Ghostty.
# Invoked from Settings → "Refresh Ghostty icon" in ghostcode.

HERE="${0:A:h}"
ICON="$HERE/../assets/ghostcode-icon.png"
APP="/Applications/Ghostty.app"

# Wait for Ghostty to fully exit (capped at ~15s so we never hang forever).
for i in $(seq 1 75); do
  pgrep -x Ghostty >/dev/null || break
  sleep 0.2
done

if command -v fileicon >/dev/null 2>&1 && [ -f "$ICON" ] && [ -d "$APP" ]; then
  fileicon set "$APP" "$ICON" >/dev/null 2>&1
  touch "$APP"
  killall Dock 2>/dev/null
  killall Finder 2>/dev/null
  sleep 1
fi

open -a Ghostty
