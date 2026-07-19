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
// CC picks the prompt-cache TTL per request: 1h on subscription, 5m on API key
// or when in plan-overage billing. The transcript records which bucket each
// turn's cache writes went to (cache_creation.ephemeral_{1h,5m}_input_tokens),
// so read the most recent non-zero entry instead of hardcoding either value.
let ttlLabel = '';
if (isClaude) {
  let idleMs = 0;
  // 0 = unknown (no cache_creation entry seen yet) — hide the pill rather
  // than guess a TTL that's wrong half the time.
  let ttl = 0;
  if (transcriptPath && fs.existsSync(transcriptPath)) {
    try { idleMs = Date.now() - fs.statSync(transcriptPath).mtimeMs; } catch {}
    try {
      const fd = fs.openSync(transcriptPath, 'r');
      const size = fs.fstatSync(fd).size;
      const len = Math.min(size, 256 * 1024);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, size - len);
      fs.closeSync(fd);
      const tail = buf.toString('utf8');
      const entries = tail.match(/"cache_creation":\{[^}]*\}/g) || [];
      for (let i = entries.length - 1; i >= 0; i--) {
        const h = /"ephemeral_1h_input_tokens":(\d+)/.exec(entries[i]);
        const m5 = /"ephemeral_5m_input_tokens":(\d+)/.exec(entries[i]);
        const h1 = h ? +h[1] : 0;
        const m = m5 ? +m5[1] : 0;
        if (h1 > 0 || m > 0) {
          ttl = h1 > 0 ? 60 * 60 * 1000 : 5 * 60 * 1000;
          break;
        }
      }
    } catch {}
  }
  if (ttl > 0) {
    const warnMs = ttl >= 60 * 60 * 1000 ? 5 * 60_000 : 60_000;
    const fmtMMSS = (ms) => {
      const s = Math.max(0, Math.floor(ms / 1000));
      return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    };
    if (idleMs < ttl - warnMs) {
      ttlLabel = `\x1b[38;2;120;180;120mttl ${fmtMMSS(ttl - idleMs)}\x1b[0m`;
    } else if (idleMs < ttl) {
      ttlLabel = `\x1b[38;2;200;170;80mttl ${fmtMMSS(ttl - idleMs)}\x1b[0m`;
    } else {
      ttlLabel = `\x1b[2mttl expired ${fmtMMSS(idleMs - ttl)}\x1b[0m`;
    }
  }
}

// Session token totals + plan usage limits (subscription rate-limit windows).
const totIn = ctxInfo.total_input_tokens || 0;
const totOut = ctxInfo.total_output_tokens || 0;
const rl = input.rate_limits || {};
function limitSeg(label, o) {
  if (!o || o.used_percentage == null) return '';
  const p = Math.max(0, Math.min(100, Math.round(o.used_percentage)));
  const col =
    p < 50 ? '\x1b[38;2;120;180;120m'
    : p < 80 ? '\x1b[38;2;200;170;80m'
    : p < 95 ? '\x1b[38;2;220;150;80m'
    : '\x1b[38;2;210;100;100m';
  let reset = '';
  if (p >= 90 && o.resets_at) {
    const d = new Date(o.resets_at * 1000);
    reset = ` ↻${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  return `${col}${label} ${p}%${reset}\x1b[0m`;
}
const limitsSeg = [limitSeg('5h', rl.five_hour), limitSeg('wk', rl.seven_day)]
  .filter(Boolean)
  .join(' ');

// Work tracker live timer — shown only when this session's watcher is alive.
let trackerLabel = '';
try {
  const sessionId = input.session_id || '';
  if (sessionId) {
    const livePath = path.join(os.homedir(), '.config/ghostcode/tracker/live', `${sessionId}.json`);
    if (fs.existsSync(livePath)) {
      const live = JSON.parse(fs.readFileSync(livePath, 'utf8'));
      if (Date.now() - (live.updated || 0) < 10_000) {
        const min = Math.round((live.attended_ms || 0) / 60000);
        const t = min < 60 ? `${min}m` : `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;
        trackerLabel = live.state === 'countdown'
          ? `\x1b[38;2;200;170;80m⏱ ${t}\x1b[0m`
          : `\x1b[2m⏱ ${t}\x1b[0m`;
      }
    }
  }
} catch {}

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
  barColored = `\x1b[38;2;120;180;120m${bar}\x1b[0m`;
} else if (scaledPct < 81) {
  barColored = `\x1b[38;2;200;170;80m${bar}\x1b[0m`;
} else if (scaledPct < 95) {
  barColored = `\x1b[38;2;220;150;80m${bar}\x1b[0m`;
} else {
  barColored = `\x1b[5;38;2;210;100;100m${bar}\x1b[0m`;
  skull = `\x1b[5;38;2;210;100;100m💀\x1b[0m `;
}

const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const sep = dim('│');

// Row 1
const modelSegment = modelName;
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

// Row 2 — last turn stats + ttl. Claude-only (others don't expose cache_read).
let row2 = '';
if (isClaude) {
  const statsSegment =
    lastSent > 0 || lastOutput > 0
      ? (() => {
          const pctColor =
            cachedPct >= 80 ? '\x1b[38;2;120;180;120m'
            : cachedPct >= 50 ? '\x1b[38;2;200;170;80m'
            : '\x1b[38;2;210;100;100m';
          const coloredPct = `\x1b[22m${pctColor}${cachedPct}%\x1b[0m\x1b[2m`;
          const sentFrac = `↑ ${fmtTokens(lastCacheRead)}/${fmtTokens(lastSent)} (${coloredPct})`;
          return dim(` ${sentFrac} · ↓ ${fmtTokens(lastOutput)}`);
        })()
      : '';
  const totalsSeg =
    totIn || totOut ? dim(`Σ ↑${fmtTokens(totIn)} ↓${fmtTokens(totOut)}`) : '';
  const segs = [statsSegment, totalsSeg, ttlLabel, trackerLabel, limitsSeg].filter(Boolean);
  if (segs.length) row2 = (statsSegment ? '' : ' ') + segs.join(' · ');
}

process.stdout.write(row1 + '\n' + (row2 ? row2 + '\n' : ''));
