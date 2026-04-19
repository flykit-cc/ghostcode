#!/bin/zsh
# Swap the Ghostty.app icon using fileicon
# (https://github.com/mklement0/fileicon).
#
# Why fileicon: it writes a Finder sidecar icon via extended attributes +
# an Icon\r resource — it does NOT modify Info.plist or the Resources
# bundle, so Ghostty's code signature stays intact and Gatekeeper is happy.
#
# Usage:
#   set-icon.sh set   [path/to/icon.png]   # apply (default: assets/ghostcode-icon.png)
#   set-icon.sh clear                       # remove custom icon, restore default

set -e

CMD="${1:-set}"
HERE="${0:A:h}"
DEFAULT_PNG="$HERE/../assets/ghostcode-icon.png"
PNG="${2:-$DEFAULT_PNG}"
APP="/Applications/Ghostty.app"

if [ ! -d "$APP" ]; then
  print -P "%F{red}error:%f $APP not found — is Ghostty installed?"
  exit 1
fi

if ! command -v fileicon >/dev/null 2>&1; then
  print -P "%F{yellow}fileicon not installed.%f Install with:"
  echo "  brew install fileicon"
  exit 1
fi

case "$CMD" in
  set)
    if [ ! -f "$PNG" ]; then
      print -P "%F{red}error:%f icon not found at $PNG"
      echo "Drop a 1024x1024 PNG there (e.g. your GhostCode claw logo)"
      echo "or pass an explicit path: set-icon.sh set ~/Downloads/claw.png"
      exit 1
    fi
    fileicon set "$APP" "$PNG"
    print -P "%F{green}✓%f icon applied. Restart Dock to refresh:"
    echo "  killall Dock"
    ;;
  clear|reset|remove)
    fileicon rm "$APP" || true
    print -P "%F{green}✓%f custom icon removed. Restart Dock to refresh:"
    echo "  killall Dock"
    ;;
  *)
    echo "usage: $0 [set|clear] [png-path]"
    exit 1
    ;;
esac
