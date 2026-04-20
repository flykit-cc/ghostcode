#!/usr/bin/env node
// GhostCode statusline for Claude Code.
// Installed at ~/.claude/statusline.js by scripts/init.sh.
// Two-row format:
//   row 1: [pill] │ model ttl M:SS │ branch │ #issues │ bar scaled% (raw%) · Ntokens/max
//   row 2: last turn  ↑ sent · ↓ recv · ~ cached (X%)
// Cache countdown + cache_read metric are Claude-only.

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
const rawModelName = (input.model && input.model.display_name) || 'Claude';
// Drop a single trailing " (...)" annotation (e.g. "Opus 4.7 (1M context)" → "Opus 4.7").
const modelName = rawModelName.replace(/\s*\([^()]*\)\s*$/, '');
const modelId = (input.model && input.model.id) || '';
const isClaude = /^claude-/i.test(modelId);

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
const isGithub = /^https:\/\/github\.com\//.test(ghUrl);

function hexToRgb(h) {
  const m = /^#([0-9a-f]{6})$/i.exec(h || '');
  if (!m) return null;
  const v = m[1];
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

const isGhostty = process.env.TERM_PROGRAM === 'ghostty' || !!process.env.GHOSTTY_RESOURCES_DIR;
const hyperlink = (url, text) =>
  isGhostty && url ? `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\` : text;

const rgb = hexToRgb(tint);
let pill = rgb
  ? `\x1b[48;2;${rgb[0]};${rgb[1]};${rgb[2]}m\x1b[97m ${projectName} \x1b[0m`
  : ` ${projectName} `;
pill = hyperlink(ghUrl, pill);

// Editor link — opens the project folder in VS Code (or Cursor as fallback).
// Hidden if neither is installed.
let editorLink = '';
if (fs.existsSync('/Applications/Visual Studio Code.app')) {
  editorLink = hyperlink(`vscode://file${projectRoot}`, `\x1b[2m<>\x1b[0m`);
} else if (fs.existsSync('/Applications/Cursor.app')) {
  editorLink = hyperlink(`cursor://file${projectRoot}`, `\x1b[2m<>\x1b[0m`);
}

// Cache TTL countdown — Claude-only.
let ttlLabel = '';
if (isClaude) {
  let idleMs = 0;
  if (transcriptPath && fs.existsSync(transcriptPath)) {
    try { idleMs = Date.now() - fs.statSync(transcriptPath).mtimeMs; } catch {}
  }
  const TTL = 5 * 60 * 1000;
  const fmtMMSS = (ms) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  if (idleMs < TTL - 60_000) {
    ttlLabel = `\x1b[92mttl ${fmtMMSS(TTL - idleMs)}\x1b[0m`;
  } else if (idleMs < TTL) {
    ttlLabel = `\x1b[93mttl ${fmtMMSS(TTL - idleMs)}\x1b[0m`;
  } else {
    ttlLabel = `\x1b[2mttl expired ${fmtMMSS(idleMs - TTL)}\x1b[0m`;
  }
}

// Issue numbers — branch name + recent commit messages on this branch.
function getIssueNumbers() {
  const nums = [];
  const seen = new Set();
  const add = (n) => { if (!seen.has(n)) { seen.add(n); nums.push(n); } };
  if (branch) {
    const m = branch.match(/(?:^|[^a-z0-9])(\d{1,5})(?:[^a-z0-9]|$)/i);
    if (m) add(m[1]);
  }
  const log = sh('git log -20 --format=%s', { cwd: projectRoot });
  const matches = log.match(/#(\d+)/g) || [];
  for (const m of matches) add(m.slice(1));
  return nums.slice(0, 3);
}
const issues = ghUrl ? getIssueNumbers() : [];
const issueBlock = issues
  .map((n) => hyperlink(isGithub ? `${ghUrl}/issues/${n}` : '', `#${n}`))
  .join(' ');

// Context window — use CC-provided fields directly.
const rawPct = Math.max(0, Math.min(100, Math.round(ctxInfo.used_percentage ?? 0)));
const scaledPct = Math.min(100, Math.round((rawPct / 80) * 100));
const ctxSize = ctxInfo.context_window_size || 0;

const usage = ctxInfo.current_usage || {};
const lastInput = usage.input_tokens || 0;
const lastCacheWrite = usage.cache_creation_input_tokens || 0;
const lastCacheRead = usage.cache_read_input_tokens || 0;
const lastOutput = usage.output_tokens || 0;
const ctxTokens = lastInput + lastCacheWrite + lastCacheRead;
const lastSent = lastInput + lastCacheWrite + lastCacheRead;
const cachedPct = lastSent > 0 ? Math.round((lastCacheRead / lastSent) * 100) : 0;

function fmtTokens(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}
function fmtCtxSize(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(0) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(0) + 'K';
  return String(n);
}

// Progress bar with color + skull.
const barWidth = 10;
const filled = Math.floor((scaledPct * barWidth) / 100);
const bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled);

let barColored, skull = '';
if (scaledPct < 63) {
  barColored = `\x1b[92m${bar}\x1b[0m`;
} else if (scaledPct < 81) {
  barColored = `\x1b[93m${bar}\x1b[0m`;
} else if (scaledPct < 95) {
  barColored = `\x1b[38;5;214m${bar}\x1b[0m`;
} else {
  barColored = `\x1b[5;91m${bar}\x1b[0m`;
  skull = `\x1b[5;91m💀\x1b[0m `;
}

const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const sep = dim('│');

// Row 1
const modelSegment = ttlLabel ? `${modelName} ${ttlLabel}` : modelName;
const ctxTokFmt = fmtTokens(ctxTokens);
const ctxMaxFmt = ctxSize ? fmtCtxSize(ctxSize) : '';
const tokenField = ctxMaxFmt ? `${ctxTokFmt}${dim('/' + ctxMaxFmt)}` : ctxTokFmt;
const barField = `${skull}${barColored} ${scaledPct}% ${dim(`(${rawPct}%)`)} · ${tokenField}`;

const pillSegment = editorLink ? `${pill} ${editorLink}` : pill;
const row1Parts = [pillSegment, modelSegment];
if (branch) row1Parts.push(branch);
if (issueBlock) row1Parts.push(issueBlock);
row1Parts.push(barField);
const row1 = row1Parts.join(` ${sep} `);

// Row 2 — last turn stats, Claude-only (others don't expose cache_read)
let row2 = '';
if (isClaude && (lastSent > 0 || lastOutput > 0)) {
  // Color the hit-rate % on its own, rest of the row stays dim.
  const pctColor =
    cachedPct >= 80 ? '\x1b[92m'  // bright green
    : cachedPct >= 50 ? '\x1b[93m'  // bright yellow
    : '\x1b[91m';                   // bright red
  const coloredPct = `\x1b[22m${pctColor}${cachedPct}%\x1b[0m\x1b[2m`;
  const sentFrac = `↑ ${fmtTokens(lastCacheRead)}/${fmtTokens(lastSent)} (${coloredPct})`;
  row2 = dim(` ${sentFrac} · ↓ ${fmtTokens(lastOutput)}`);
}

process.stdout.write(row1 + '\n' + (row2 ? row2 + '\n' : ''));
