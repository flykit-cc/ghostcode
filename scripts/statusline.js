#!/usr/bin/env node
// GhostCode statusline for Claude Code.
// Installed at ~/.claude/statusline.js by scripts/init.sh.
// Format: [colored pill] │ model ● │ branch │ bar scaled% (raw%) · Ntokens

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

let input = {};
try {
  const raw = fs.readFileSync(0, 'utf8');
  if (raw) input = JSON.parse(raw);
} catch {}

const cwd = input.cwd || (input.workspace && input.workspace.current_dir) || process.cwd();
const modelName = (input.model && input.model.display_name) || 'Claude';
const transcriptPath = input.transcript_path || '';
const ctxInfo = input.context_window || {};
const worktree = input.worktree || {};

function sh(cmd, opts = {}) {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'], ...opts }).toString().trim();
  } catch { return ''; }
}

const projectRoot = sh('git rev-parse --show-toplevel', { cwd }) || cwd;
const projectName = path.basename(projectRoot);

const branch = worktree.branch || sh('git branch --show-current', { cwd: projectRoot });

let tint = '';
try {
  const state = JSON.parse(
    fs.readFileSync(path.join(os.homedir(), '.config/ghostcode/state.json'), 'utf8')
  );
  const pp = state.perProject || {};
  tint = (pp[projectRoot] && pp[projectRoot].color) || (pp[cwd] && pp[cwd].color) || '';
} catch {}

function toHttpsUrl(remote) {
  if (!remote) return '';
  let m = remote.match(/^git@([^:]+):(.+?)(\.git)?$/);
  if (m) return `https://${m[1]}/${m[2]}`;
  m = remote.match(/^(https?:\/\/.+?)(\.git)?$/);
  if (m) return m[1];
  return '';
}
const ghUrl = toHttpsUrl(sh('git remote get-url origin', { cwd: projectRoot }));

function hexToRgb(h) {
  const m = /^#([0-9a-f]{6})$/i.exec(h || '');
  if (!m) return null;
  const v = m[1];
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

const isGhostty = process.env.TERM_PROGRAM === 'ghostty' || !!process.env.GHOSTTY_RESOURCES_DIR;
const rgb = hexToRgb(tint);
let pill = rgb
  ? `\x1b[48;2;${rgb[0]};${rgb[1]};${rgb[2]}m\x1b[97m ${projectName} \x1b[0m`
  : ` ${projectName} `;
if (isGhostty && ghUrl) {
  pill = `\x1b]8;;${ghUrl}\x1b\\${pill}\x1b]8;;\x1b\\`;
}

// Cache indicator — Claude-only (5min TTL on Anthropic prompt cache).
// Live countdown; requires statusLine.refreshInterval in settings.json.
const modelId = (input.model && input.model.id) || '';
const isClaude = /^claude-/i.test(modelId);

let cacheDot = '';
if (isClaude) {
  let idleMs = 0;
  if (transcriptPath && fs.existsSync(transcriptPath)) {
    try {
      idleMs = Date.now() - fs.statSync(transcriptPath).mtimeMs;
    } catch {}
  }
  const TTL = 5 * 60 * 1000;
  const fmtMMSS = (ms) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  if (idleMs < TTL - 60_000) {
    cacheDot = `\x1b[32m⏱ ${fmtMMSS(TTL - idleMs)}\x1b[0m`;       // green
  } else if (idleMs < TTL) {
    cacheDot = `\x1b[33m⏱ ${fmtMMSS(TTL - idleMs)}\x1b[0m`;       // yellow
  } else {
    cacheDot = `\x1b[2m○ ${fmtMMSS(idleMs - TTL)}\x1b[0m`;         // dim elapsed
  }
}

// Context window — use CC-provided fields directly.
const rawPct = Math.max(0, Math.min(100, Math.round(ctxInfo.used_percentage ?? 0)));
// Scale: CC auto-compacts at 80% → display 100% at 80% real.
const scaledPct = Math.min(100, Math.round((rawPct / 80) * 100));

const usage = ctxInfo.current_usage || {};
const ctxTokens =
  (usage.input_tokens || 0) +
  (usage.cache_creation_input_tokens || 0) +
  (usage.cache_read_input_tokens || 0);

function fmtTokens(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

// 10-segment progress bar.
const barWidth = 10;
const filled = Math.floor((scaledPct * barWidth) / 100);
const bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled);

let barColored, skull = '';
if (scaledPct < 63) {
  barColored = `\x1b[32m${bar}\x1b[0m`;
} else if (scaledPct < 81) {
  barColored = `\x1b[33m${bar}\x1b[0m`;
} else if (scaledPct < 95) {
  barColored = `\x1b[38;5;208m${bar}\x1b[0m`;
} else {
  barColored = `\x1b[5;31m${bar}\x1b[0m`;
  skull = `\x1b[5;31m💀\x1b[0m `;
}

const dim = s => `\x1b[2m${s}\x1b[0m`;
const sep = dim('│');

const parts = [pill, cacheDot ? `${modelName} ${cacheDot}` : modelName];
if (branch) parts.push(branch);
parts.push(`${skull}${barColored} ${scaledPct}% ${dim(`(${rawPct}%)`)} · ${fmtTokens(ctxTokens)}`);

process.stdout.write(parts.join(` ${sep} `) + '\n');
