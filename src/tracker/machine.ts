// Pure presence/clock state machine for the work tracker. No I/O — the
// watcher feeds probes in and executes the returned effects (say/afplay).

export type TrackerConfig = { presenceIdleSec: number; graceSec: number };
export type Probe = {
  now: number;
  agentWorking: boolean;
  frontmost: boolean;
  inputIdleSec: number;
};
export type Phase = "working" | "waiting" | "countdown" | "idle";
export type MachineState = {
  phase: Phase;
  attendedMs: number;
  agentMs: number;
  countdownEndsAt: number | null;
  lastNow: number | null;
  lastCallout: number | null;
};
export type Effects = {
  say: string | null;
  chime: boolean;
  becameIdle: boolean;
  resumed: boolean;
};

const MAX_TICK_MS = 10_000;

export function initialState(): MachineState {
  return {
    phase: "waiting",
    attendedMs: 0,
    agentMs: 0,
    countdownEndsAt: null,
    lastNow: null,
    lastCallout: null,
  };
}

export function tick(
  s: MachineState,
  p: Probe,
  cfg: TrackerConfig,
): { state: MachineState; effects: Effects } {
  const effects: Effects = { say: null, chime: false, becameIdle: false, resumed: false };
  const dt =
    s.lastNow === null ? 0 : Math.max(0, Math.min(p.now - s.lastNow, MAX_TICK_MS));
  const present = p.frontmost && p.inputIdleSec < cfg.presenceIdleSec;

  // Next phase
  let phase: Phase;
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
    effects.say =
      cfg.graceSec >= 60 ? "going idle in one minute" : `going idle in ${cfg.graceSec} seconds`;
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

  if (s.phase === "idle" && phase !== "idle") effects.resumed = true;

  // Clocks: accrue for the interval that just elapsed, based on the state
  // we end up in (countdown grace counts as attended; idle counts nothing).
  const agentMs = s.agentMs + (p.agentWorking ? dt : 0);
  const attendedAccrues = present || phase === "countdown" || (s.phase === "countdown" && phase === "idle");
  const attendedMs = s.attendedMs + (attendedAccrues ? dt : 0);

  return {
    state: { phase, attendedMs, agentMs, countdownEndsAt, lastNow: p.now, lastCallout },
    effects,
  };
}
