// src/tracker/watcher.ts
import { execFileSync, execSync, spawn } from "node:child_process";
import {
  closeSync,
  existsSync as existsSync2,
  mkdirSync as mkdirSync2,
  openSync,
  readFileSync as readFileSync2,
  readSync,
  statSync as statSync2,
  unlinkSync,
  writeFileSync as writeFileSync2
} from "node:fs";
import { basename, dirname, join as join2 } from "node:path";
import { homedir as homedir2 } from "node:os";

// src/tracker/machine.ts
var MAX_TICK_MS = 1e4;
function initialState() {
  return {
    phase: "waiting",
    attendedMs: 0,
    agentMs: 0,
    countdownEndsAt: null,
    lastNow: null,
    lastCallout: null
  };
}
function tick(s, p, cfg) {
  const effects = { say: null, chime: false, becameIdle: false, resumed: false };
  const dt = s.lastNow === null ? 0 : Math.max(0, Math.min(p.now - s.lastNow, MAX_TICK_MS));
  const present = p.frontmost && p.inputIdleSec < cfg.presenceIdleSec;
  let phase;
  let countdownEndsAt = s.countdownEndsAt;
  let lastCallout = s.lastCallout;
  if (p.agentWorking) {
    phase = "working";
    countdownEndsAt = null;
    lastCallout = null;
  } else if (present) {
    phase = "waiting";
    countdownEndsAt = null;
    lastCallout = null;
  } else if (s.phase === "idle") {
    phase = "idle";
  } else if (countdownEndsAt === null) {
    phase = "countdown";
    countdownEndsAt = p.now + cfg.graceSec * 1000;
    lastCallout = null;
    effects.say = cfg.graceSec >= 60 ? "going idle in one minute" : `going idle in ${cfg.graceSec} seconds`;
  } else if (p.now >= countdownEndsAt) {
    phase = "idle";
    countdownEndsAt = null;
    effects.chime = true;
    effects.becameIdle = true;
  } else {
    phase = "countdown";
    const remaining = Math.floor((countdownEndsAt - p.now) / 1000);
    if (remaining <= 5 && remaining >= 1 && lastCallout !== remaining) {
      effects.say = String(remaining);
      lastCallout = remaining;
    }
  }
  if (s.phase === "idle" && phase !== "idle")
    effects.resumed = true;
  const agentMs = s.agentMs + (p.agentWorking ? dt : 0);
  const attendedAccrues = present || phase === "countdown" || s.phase === "countdown" && phase === "idle";
  const attendedMs = s.attendedMs + (attendedAccrues ? dt : 0);
  return {
    state: { phase, attendedMs, agentMs, countdownEndsAt, lastNow: p.now, lastCallout },
    effects
  };
}

// src/tracker/log.ts
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
var TRACKER_DIR = join(homedir(), ".config/ghostcode/tracker");
var pad = (n) => String(n).padStart(2, "0");
function eventsPathFor(d) {
  return join(TRACKER_DIR, `events-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.jsonl`);
}
function livePathFor(sessionId) {
  return join(TRACKER_DIR, "live", `${sessionId}.json`);
}
function appendEvent(obj) {
  try {
    mkdirSync(TRACKER_DIR, { recursive: true });
    const rec = { ts: new Date().toISOString(), ...obj };
    appendFileSync(eventsPathFor(new Date), JSON.stringify(rec) + `
`);
  } catch {}
}
function readTrackerConfig() {
  const defaults = { presenceIdleSec: 180, graceSec: 60, audio: true };
  try {
    const cfg = JSON.parse(readFileSync(join(homedir(), ".config/ghostcode/config.json"), "utf8"));
    return { ...defaults, ...cfg.tracker || {} };
  } catch {
    return defaults;
  }
}
function debugLog(msg) {
  try {
    mkdirSync(TRACKER_DIR, { recursive: true });
    const p = join(TRACKER_DIR, "debug.log");
    if (existsSync(p) && statSync(p).size > 1e6)
      writeFileSync(p, "");
    appendFileSync(p, `${new Date().toISOString()} ${msg}
`);
  } catch {}
}

// src/tracker/watcher.ts
var [sessionId, projectRoot, , parentPidRaw] = process.argv.slice(2);
var parentPid = Number(parentPidRaw) || 0;
if (!sessionId || !projectRoot)
  process.exit(0);
var cfg = readTrackerConfig();
var livePath = livePathFor(sessionId);
var pidPath = livePath + ".pid";
try {
  mkdirSync2(dirname(livePath), { recursive: true });
  if (existsSync2(pidPath)) {
    const old = Number(readFileSync2(pidPath, "utf8"));
    try {
      process.kill(old, 0);
      process.exit(0);
    } catch {}
  }
  writeFileSync2(pidPath, String(process.pid));
} catch (e) {
  debugLog(`watcher init: ${e}`);
}
var agentWorking = false;
var agentStoppedAt = 0;
var lastLocalInputAt = Date.now();
var eventsOffset = -1;
var eventsDay = "";
function pollEvents() {
  try {
    const day = new Date().toISOString().slice(0, 10);
    const p = eventsPathFor(new Date);
    if (day !== eventsDay) {
      eventsDay = day;
      eventsOffset = -1;
    }
    if (!existsSync2(p))
      return;
    const size = statSync2(p).size;
    if (eventsOffset === -1)
      eventsOffset = 0;
    if (size <= eventsOffset)
      return;
    const fd = openSync(p, "r");
    const buf = Buffer.alloc(size - eventsOffset);
    readSync(fd, buf, 0, buf.length, eventsOffset);
    closeSync(fd);
    eventsOffset = size;
    for (const line of buf.toString("utf8").split(`
`)) {
      if (!line.includes(sessionId))
        continue;
      try {
        const e = JSON.parse(line);
        if (e.session_id !== sessionId)
          continue;
        if (e.event === "prompt") {
          agentWorking = true;
          lastLocalInputAt = Date.now();
        }
        if (e.event === "stop") {
          agentWorking = false;
          agentStoppedAt = Date.now();
        }
        if (e.event === "session_end")
          shutdown();
      } catch {}
    }
  } catch (e) {
    debugLog(`pollEvents: ${e}`);
  }
}
function frontmostIsGhostty() {
  try {
    const asn = execSync("lsappinfo front", { timeout: 1000 }).toString().trim();
    if (!asn)
      return false;
    const info = execFileSync("lsappinfo", ["info", "-only", "name", asn], {
      timeout: 1000
    }).toString();
    return /ghostty/i.test(info);
  } catch {
    return false;
  }
}
var ttyPath = null;
try {
  const tty = execFileSync("ps", ["-o", "tty=", "-p", String(parentPid)], {
    timeout: 1000
  }).toString().trim();
  if (tty && tty !== "??")
    ttyPath = `/dev/${tty}`;
} catch {}
var kbLast = null;
function keyboardIdleSec() {
  const now = Date.now();
  try {
    const out = execFileSync("osascript", [
      "-l",
      "JavaScript",
      "-e",
      "ObjC.import('CoreGraphics'); $.CGEventSourceSecondsSinceLastEventType(1, 10)"
    ], { timeout: 3000 }).toString().trim();
    const n = Number(out);
    if (Number.isFinite(n)) {
      kbLast = { idle: n, at: now };
      return n;
    }
  } catch {}
  if (kbLast)
    return kbLast.idle + (now - kbLast.at) / 1000;
  return Infinity;
}
function ttyIdleSecOrNull() {
  if (!ttyPath)
    return null;
  try {
    return Math.max(0, (Date.now() - statSync2(ttyPath).atimeMs) / 1000);
  } catch {
    ttyPath = null;
    return null;
  }
}
function say(text) {
  if (!cfg.audio)
    return;
  try {
    spawn("say", [text], { detached: true, stdio: "ignore" }).unref();
  } catch {}
}
function chime() {
  if (!cfg.audio)
    return;
  try {
    spawn("afplay", ["/System/Library/Sounds/Submarine.aiff"], {
      detached: true,
      stdio: "ignore"
    }).unref();
  } catch {}
}
var XI_KEY = process.env.ELEVENLABS_API_KEY || "";
var XI_VOICE = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
var AUDIO_DIR = join2(homedir2(), ".config/ghostcode/tracker/audio");
var projectName = basename(projectRoot);
var slug = projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
var warnClip = join2(AUDIO_DIR, `${slug}-going-idle.mp3`);
var idleClip = join2(AUDIO_DIR, `${slug}-is-idle.mp3`);
var digitClip = (n) => join2(AUDIO_DIR, `digit-${n}.mp3`);
async function xiGenerate(text, outPath) {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${XI_VOICE}`, {
    method: "POST",
    headers: { "xi-api-key": XI_KEY, "content-type": "application/json" },
    body: JSON.stringify({ text, model_id: "eleven_flash_v2_5" })
  });
  if (!res.ok)
    throw new Error(`elevenlabs ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync2(outPath, buf);
}
async function ensureAudioClips() {
  if (!XI_KEY || !cfg.audio)
    return;
  try {
    mkdirSync2(AUDIO_DIR, { recursive: true });
    const wanted = [
      [warnClip, `${projectName} going idle in 1 minute`],
      [idleClip, `${projectName} is idle`],
      ...["5", "4", "3", "2", "1"].map((n) => [digitClip(n), n])
    ];
    for (const [path, text] of wanted) {
      if (existsSync2(path))
        continue;
      await xiGenerate(text, path);
    }
  } catch (e) {
    debugLog(`ensureAudioClips: ${e}`);
  }
}
function playClip(path) {
  if (!cfg.audio)
    return true;
  if (!existsSync2(path))
    return false;
  try {
    spawn("afplay", [path], { detached: true, stdio: "ignore" }).unref();
    return true;
  } catch {
    return false;
  }
}
function speak(text) {
  if (/^going idle/.test(text)) {
    if (playClip(warnClip))
      return;
  } else if (/^[1-5]$/.test(text)) {
    if (playClip(digitClip(text)))
      return;
  }
  say(`${text}`);
}
function announceIdle() {
  if (playClip(idleClip))
    return;
  chime();
}
var state = initialState();
var done = false;
ensureAudioClips();
var prevFrontmost = true;
function shutdown() {
  if (done)
    return;
  done = true;
  try {
    appendEvent({
      event: "session_total",
      session_id: sessionId,
      project: projectRoot,
      attended_ms: Math.round(state.attendedMs),
      agent_ms: Math.round(state.agentMs)
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
    const kbIdle = keyboardIdleSec();
    const ttyIdle = ttyIdleSecOrNull();
    if (kbIdle <= 2.5 && front && (ttyIdle === null || ttyIdle <= 3)) {
      lastLocalInputAt = now - kbIdle * 1000;
    }
    const sinceLocalSec = (now - lastLocalInputAt) / 1000;
    const sinceStopSec = agentStoppedAt ? (now - agentStoppedAt) / 1000 : Infinity;
    const r = tick(state, {
      now,
      agentWorking,
      frontmost,
      inputIdleSec: Math.min(sinceLocalSec, sinceStopSec)
    }, cfg);
    state = r.state;
    if (r.effects.say)
      speak(r.effects.say);
    if (r.effects.chime)
      announceIdle();
    if (r.effects.becameIdle)
      appendEvent({ event: "idle_start", session_id: sessionId, project: projectRoot });
    if (r.effects.resumed)
      appendEvent({ event: "idle_end", session_id: sessionId, project: projectRoot });
    writeFileSync2(livePath, JSON.stringify({
      state: state.phase,
      attended_ms: Math.round(state.attendedMs),
      agent_ms: Math.round(state.agentMs),
      updated: Date.now()
    }));
  } catch (e) {
    debugLog(`watcher tick: ${e}`);
  }
}, 2000);
