#!/bin/zsh
# GhostCode first-run setup wizard.
# Runs on first Ghostty open (launcher.sh detects a missing marker file).
# To re-run: delete ~/.config/ghostcode/.setup-complete or use Settings → Re-run setup.

set -u

SCRIPT_DIR="${0:A:h}"
REPO_ROOT="${SCRIPT_DIR:h}"

MARKER="$HOME/.config/ghostcode/.setup-complete"
CONFIG_DIR="$HOME/.config/ghostcode"
STATUSLINE_CMD="$SCRIPT_DIR/statusline.sh"
ICON_SCRIPT="$SCRIPT_DIR/set-icon.sh"
ICON_PNG="$REPO_ROOT/assets/ghostcode-icon.png"
GHOSTTY_CONF="$HOME/Library/Application Support/com.mitchellh.ghostty/config.ghostty"
CC_SETTINGS="$HOME/.claude/settings.json"

mkdir -p "$CONFIG_DIR"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

section() { printf "\n\033[1;35m› %s\033[0m\n" "$1"; }
ok()      { printf "  \033[32m✓\033[0m %s\n" "$1"; }
skip()    { printf "  \033[2m∘ %s\033[0m\n" "$1"; }
abort()   { printf "\n\033[1;31m✗ %s\033[0m\n" "$1"; exit 1; }

# read_yn: prints prompt and returns 0 on y/Y/<Enter>, 1 on n/N.
read_yn() {
  local prompt="$1" reply
  printf "  %s [Y/n] " "$prompt"
  read -r reply
  [[ -z "$reply" || "$reply" == "y" || "$reply" == "Y" ]]
}

# ── Banner ─────────────────────────────────────────────────────────────
cat <<'EOF'

┌─────────────────────────────────────────────────────────────┐
│                     GhostCode setup                         │
│              Ghostty × Claude Code · first run              │
└─────────────────────────────────────────────────────────────┘

What this wizard will do:
  • Install Ghostty if missing
  • Wire Ghostty to launch GhostCode on startup
  • Wire CC statusline to show project tints
  • Apply the GhostCode icon to Ghostty.app

GhostCode is MIT-licensed. No telemetry. Not affiliated with
Anthropic or Mitchell Hashimoto. Source: github.com/flykit-cc/ghostcode

EOF

read_yn "Continue?" || { echo "Setup cancelled."; exit 0; }

# ── Preflight: Homebrew ────────────────────────────────────────────────
if ! command -v brew >/dev/null 2>&1; then
  abort "Homebrew required. Install: /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
fi

# ── Step 1: Ghostty (required) ─────────────────────────────────────────
section "Ghostty"

if [ -d "/Applications/Ghostty.app" ]; then
  ok "Ghostty already installed"
else
  read_yn "Install Ghostty via brew cask?" || \
    abort "GhostCode is a Ghostty launcher — install Ghostty first, then re-run."
  brew install --cask ghostty || abort "Ghostty install failed"
  ok "Ghostty installed"
fi

# ── Step 2: Claude Code (silent fallback) ──────────────────────────────
if ! command -v claude >/dev/null 2>&1; then
  section "Claude Code"
  echo "  Installing Claude Code..."
  command -v npm >/dev/null 2>&1 || brew install node
  npm install -g @anthropic-ai/claude-code >/dev/null 2>&1 || \
    abort "Claude Code install failed. Run: npm i -g @anthropic-ai/claude-code"
  ok "Claude Code installed"
fi

# ── Step 3: fileicon (required — applies the icon) ─────────────────────
section "fileicon"

if command -v fileicon >/dev/null 2>&1; then
  ok "fileicon already installed"
else
  brew install fileicon >/dev/null 2>&1 || abort "fileicon install failed"
  ok "fileicon installed"
fi

# ── Step 4: Ghostty config wiring ──────────────────────────────────────
section "Ghostty configuration"

mkdir -p "$(dirname "$GHOSTTY_CONF")"
touch "$GHOSTTY_CONF"
if grep -q '^command = ghostcode$' "$GHOSTTY_CONF"; then
  ok "Ghostty already launches GhostCode"
else
  tmp=$(mktemp)
  grep -v '^command = ' "$GHOSTTY_CONF" > "$tmp" && mv "$tmp" "$GHOSTTY_CONF"
  printf '\n# Added by GhostCode setup\ncommand = ghostcode\n' >> "$GHOSTTY_CONF"
  ok "Wrote Ghostty startup command"
fi

# ── Step 5: CC statusline ──────────────────────────────────────────────
section "Claude Code statusline"

mkdir -p "$(dirname "$CC_SETTINGS")"
if [ -f "$CC_SETTINGS" ] && grep -q "ghostcode/scripts/statusline.sh" "$CC_SETTINGS"; then
  ok "CC statusline already wired"
else
  if [ -f "$CC_SETTINGS" ]; then
    node -e "
      const fs=require('fs');
      const p='$CC_SETTINGS';
      const j=JSON.parse(fs.readFileSync(p,'utf8'));
      j.statusLine={type:'command',command:'$STATUSLINE_CMD'};
      fs.writeFileSync(p,JSON.stringify(j,null,2));
    "
  else
    cat > "$CC_SETTINGS" <<EOF
{
  "statusLine": {
    "type": "command",
    "command": "$STATUSLINE_CMD"
  }
}
EOF
  fi
  ok "Wrote CC statusline config"
fi

# ── Step 6: Apply icon (always) ────────────────────────────────────────
section "GhostCode icon"

"$ICON_SCRIPT" set >/dev/null 2>&1 && {
  touch "/Applications/Ghostty.app"
  killall Dock 2>/dev/null || true
  killall Finder 2>/dev/null || true
  ok "Icon applied"
} || skip "Icon apply failed (non-fatal)"

# ── Done ───────────────────────────────────────────────────────────────
touch "$MARKER"
printf "\n\033[1;32m✓ GhostCode setup complete\033[0m\n"
printf "\033[2mLaunching GhostCode...\033[0m\n"
sleep 1
