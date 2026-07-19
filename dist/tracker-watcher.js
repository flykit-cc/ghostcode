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
import { dirname } from "node:path";

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
        if (e.event === "prompt")
          agentWorking = true;
        if (e.event === "stop")
          agentWorking = false;
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
function inputIdleSec() {
  try {
    const out = execSync("ioreg -c IOHIDSystem | awk '/HIDIdleTime/ {print int($NF/1000000000); exit}'", { timeout: 1000, shell: "/bin/sh" }).toString().trim();
    return Number(out) || 0;
  } catch {
    return 0;
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
var state = initialState();
var done = false;
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
    const r = tick(state, {
      now: Date.now(),
      agentWorking,
      frontmost: frontmostIsGhostty(),
      inputIdleSec: inputIdleSec()
    }, cfg);
    state = r.state;
    if (r.effects.say)
      say(r.effects.say);
    if (r.effects.chime)
      chime();
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
