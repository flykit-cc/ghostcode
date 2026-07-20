// Per-session tracker daemon. Spawned by the hook on SessionStart with:
//   argv: sessionId projectRoot transcriptPath parentPid
// Polls presence every 2s, drives the state machine, plays countdown audio,
// maintains the live file for the statusline, and flushes session totals.
import { execFileSync, execSync, spawn } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { homedir } from "node:os";
import { initialState, tick, type MachineState } from "./machine.ts";
import { appendEvent, debugLog, eventsPathFor, livePathFor, readTrackerConfig } from "./log.ts";

const [sessionId, projectRoot, , parentPidRaw] = process.argv.slice(2);
const parentPid = Number(parentPidRaw) || 0;
if (!sessionId || !projectRoot) process.exit(0);

const cfg = readTrackerConfig();
const livePath = livePathFor(sessionId);
const pidPath = livePath + ".pid";

// Singleton per session.
try {
  mkdirSync(dirname(livePath), { recursive: true });
  if (existsSync(pidPath)) {
    const old = Number(readFileSync(pidPath, "utf8"));
    try {
      process.kill(old, 0);
      process.exit(0);
    } catch {}
  }
  writeFileSync(pidPath, String(process.pid));
} catch (e) {
  debugLog(`watcher init: ${e}`);
}

let agentWorking = false;
// When the agent stops, the user's attention decision starts THEN — not at
// their last keystroke (which may be many minutes old after a long agent
// run). Idle is measured from whichever is more recent.
let agentStoppedAt = 0;
// Timestamp of the last keypress ATTRIBUTED TO THIS WINDOW (see tick loop).
// Seeded with session start — a human just launched it.
let lastLocalInputAt = Date.now();
let eventsOffset = -1; // -1 = read whole file on first pass
let eventsDay = "";

function pollEvents(): void {
  // Tail today's events file incrementally; track prompt/stop/session_end.
  try {
    const day = new Date().toISOString().slice(0, 10);
    const p = eventsPathFor(new Date());
    if (day !== eventsDay) {
      eventsDay = day;
      eventsOffset = -1;
    }
    if (!existsSync(p)) return;
    const size = statSync(p).size;
    if (eventsOffset === -1) eventsOffset = 0;
    if (size <= eventsOffset) return;
    const fd = openSync(p, "r");
    const buf = Buffer.alloc(size - eventsOffset);
    readSync(fd, buf, 0, buf.length, eventsOffset);
    closeSync(fd);
    eventsOffset = size;
    for (const line of buf.toString("utf8").split("\n")) {
      if (!line.includes(sessionId)) continue;
      try {
        const e = JSON.parse(line);
        if (e.session_id !== sessionId) continue;
        if (e.event === "prompt") {
          agentWorking = true;
          // A submitted prompt is definitive typing into THIS session.
          lastLocalInputAt = Date.now();
        }
        if (e.event === "stop") {
          agentWorking = false;
          agentStoppedAt = Date.now();
        }
        if (e.event === "session_end") shutdown();
      } catch {}
    }
  } catch (e) {
    debugLog(`pollEvents: ${e}`);
  }
}

function frontmostIsGhostty(): boolean {
  try {
    const asn = execSync("lsappinfo front", { timeout: 1000 }).toString().trim();
    if (!asn) return false;
    const info = execFileSync("lsappinfo", ["info", "-only", "name", asn], {
      timeout: 1000,
    }).toString();
    return /ghostty/i.test(info);
  } catch {
    return false;
  }
}

// Per-session input idle: the kernel bumps a tty's atime on every keystroke
// typed into THAT terminal (same mechanism `w` uses), so with several Ghostty
// windows open, typing in one doesn't mark the others as attended. Falls back
// to the machine-wide HID idle timer when the CC process has no tty.
let ttyPath: string | null = null;
try {
  const tty = execFileSync("ps", ["-o", "tty=", "-p", String(parentPid)], {
    timeout: 1000,
  })
    .toString()
    .trim();
  if (tty && tty !== "??") ttyPath = `/dev/${tty}`;
} catch {}

// Seconds since the last real KEYBOARD press, machine-wide.
// CGEventSourceSecondsSinceLastEventType(1, kCGEventKeyDown=10) counts key
// presses only — mouse moves, scrolls, and swipes don't register. On an
// osascript hiccup we extrapolate from the last good reading: idle can only
// have grown unless a key was pressed, and missing one tick of typing is
// better than un-pausing on a phantom zero.
let kbLast: { idle: number; at: number } | null = null;
function keyboardIdleSec(): number {
  const now = Date.now();
  try {
    const out = execFileSync(
      "osascript",
      ["-l", "JavaScript", "-e",
        "ObjC.import('CoreGraphics'); $.CGEventSourceSecondsSinceLastEventType(1, 10)"],
      { timeout: 3000 },
    )
      .toString()
      .trim();
    const n = Number(out);
    if (Number.isFinite(n)) {
      kbLast = { idle: n, at: now };
      return n;
    }
  } catch {}
  if (kbLast) return kbLast.idle + (now - kbLast.at) / 1000;
  return Infinity; // no reading yet — treat as not typing
}

function ttyIdleSecOrNull(): number | null {
  if (!ttyPath) return null;
  try {
    return Math.max(0, (Date.now() - statSync(ttyPath).atimeMs) / 1000);
  } catch {
    ttyPath = null; // tty vanished
    return null;
  }
}

function say(text: string): void {
  if (!cfg.audio) return;
  try {
    spawn("say", [text], { detached: true, stdio: "ignore" }).unref();
  } catch {}
}
function chime(): void {
  if (!cfg.audio) return;
  try {
    spawn("afplay", ["/System/Library/Sounds/Submarine.aiff"], {
      detached: true,
      stdio: "ignore",
    }).unref();
  } catch {}
}

// ── ElevenLabs voice lines — generated once, cached forever ─────────────
// Per-project: "<project> going idle in 1 minute", "<project> is idle".
// Shared across projects: digits 5..1. Generated on watcher start when the
// key is present; playback falls back to `say`/chime while (or if) files
// don't exist, so audio never goes silent.
const XI_KEY = process.env.ELEVENLABS_API_KEY || "";
// Voice: env override, else the first voice in the ACCOUNT's own library —
// hardcoding a premade voice 402s on accounts that don't have it.
let xiVoice = process.env.ELEVENLABS_VOICE_ID || "";

async function resolveVoice(): Promise<string> {
  if (xiVoice) return xiVoice;
  const res = await fetch("https://api.elevenlabs.io/v1/voices", {
    headers: { "xi-api-key": XI_KEY },
  });
  if (!res.ok) throw new Error(`elevenlabs voices ${res.status}`);
  const j = (await res.json()) as { voices?: Array<{ voice_id: string }> };
  const id = j.voices?.[0]?.voice_id;
  if (!id) throw new Error("elevenlabs: account has no voices");
  xiVoice = id;
  return id;
}
const AUDIO_DIR = join(homedir(), ".config/ghostcode/tracker/audio");
const projectName = basename(projectRoot);
const slug = projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
const warnClip = join(AUDIO_DIR, `${slug}-going-idle.mp3`);
const idleClip = join(AUDIO_DIR, `${slug}-is-idle.mp3`);
const digitClip = (n: string) => join(AUDIO_DIR, `digit-${n}.mp3`);

async function xiGenerate(text: string, outPath: string): Promise<void> {
  const voice = await resolveVoice();
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voice}`,
    {
      method: "POST",
      headers: { "xi-api-key": XI_KEY, "content-type": "application/json" },
      body: JSON.stringify({ text, model_id: "eleven_flash_v2_5" }),
    },
  );
  if (!res.ok) throw new Error(`elevenlabs ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(outPath, buf);
}

async function ensureAudioClips(): Promise<void> {
  if (!XI_KEY || !cfg.audio) return;
  try {
    mkdirSync(AUDIO_DIR, { recursive: true });
    const wanted: Array<[string, string]> = [
      [warnClip, `${projectName} going idle in 1 minute`],
      [idleClip, `${projectName} is idle`],
      ...["5", "4", "3", "2", "1"].map(
        (n) => [digitClip(n), n] as [string, string],
      ),
    ];
    for (const [path, text] of wanted) {
      if (existsSync(path)) continue;
      await xiGenerate(text, path); // sequential — gentle on rate limits
    }
  } catch (e) {
    debugLog(`ensureAudioClips: ${e}`);
  }
}

function playClip(path: string): boolean {
  if (!cfg.audio) return true; // audio disabled — swallow silently
  if (!existsSync(path)) return false;
  try {
    spawn("afplay", [path], { detached: true, stdio: "ignore" }).unref();
    return true;
  } catch {
    return false;
  }
}

function speak(text: string): void {
  // Map machine speech to cached clips; fall back to macOS `say`.
  if (/^going idle/.test(text)) {
    if (playClip(warnClip)) return;
  } else if (/^[1-5]$/.test(text)) {
    if (playClip(digitClip(text))) return;
  }
  say(`${text}`);
}

function announceIdle(): void {
  if (playClip(idleClip)) return;
  chime();
}

let state: MachineState = initialState();
let done = false;

// Pre-generate this project's voice clips in the background (no-op when they
// already exist or no ELEVENLABS_API_KEY is set).
void ensureAudioClips();

// Space-switch animations make `lsappinfo front` report another app for a
// single poll even though the user never left. Require TWO consecutive
// non-Ghostty samples before treating Ghostty as backgrounded, so a 1-tick
// flicker can't re-arm the countdown (and replay its announcement).
let prevFrontmost = true;

function shutdown(): void {
  if (done) return;
  done = true;
  try {
    appendEvent({
      event: "session_total",
      session_id: sessionId,
      project: projectRoot,
      attended_ms: Math.round(state.attendedMs),
      agent_ms: Math.round(state.agentMs),
    });
  } catch {}
  try {
    unlinkSync(livePath);
  } catch {}
  try {
    unlinkSync(pidPath);
  } catch {}
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

setInterval(() => {
  try {
    // Parent CC process gone → session over.
    if (parentPid) {
      try {
        process.kill(parentPid, 0);
      } catch {
        return shutdown();
      }
    }
    pollEvents();
    const now = Date.now();
    const front = frontmostIsGhostty();
    const frontmost = front || prevFrontmost;
    prevFrontmost = front;
    // Keypress attribution: a keypress belongs to THIS window only when, in
    // the same poll window, (a) a key was genuinely pressed (keyboard-only
    // idle ~0 — hover/scroll/swipe/focus events don't register there), (b)
    // Ghostty is frontmost, and (c) this window's tty consumed input bytes.
    // Mouse/focus bytes fail (a); typing in another window fails (c). Known
    // leak: typing in window A while simultaneously hovering window B.
    const kbIdle = keyboardIdleSec();
    const ttyIdle = ttyIdleSecOrNull();
    if (kbIdle <= 2.5 && front && (ttyIdle === null || ttyIdle <= 3)) {
      lastLocalInputAt = now - kbIdle * 1000;
    }
    const sinceLocalSec = (now - lastLocalInputAt) / 1000;
    // Fresh 3-minute window from the moment the agent stopped, even if the
    // last real keystroke is older (long agent runs need no typing).
    const sinceStopSec = agentStoppedAt ? (now - agentStoppedAt) / 1000 : Infinity;
    const r = tick(
      state,
      {
        now,
        agentWorking,
        frontmost,
        inputIdleSec: Math.min(sinceLocalSec, sinceStopSec),
      },
      cfg,
    );
    state = r.state;
    if (r.effects.say) speak(r.effects.say);
    if (r.effects.chime) announceIdle();
    if (r.effects.becameIdle)
      appendEvent({ event: "idle_start", session_id: sessionId, project: projectRoot });
    if (r.effects.resumed)
      appendEvent({ event: "idle_end", session_id: sessionId, project: projectRoot });
    writeFileSync(
      livePath,
      JSON.stringify({
        state: state.phase,
        attended_ms: Math.round(state.attendedMs),
        agent_ms: Math.round(state.agentMs),
        updated: Date.now(),
      }),
    );
  } catch (e) {
    debugLog(`watcher tick: ${e}`);
  }
}, 2000);
