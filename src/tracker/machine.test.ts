import { describe, test, expect } from "bun:test";
import { initialState, tick, type Probe, type TrackerConfig } from "./machine.ts";

const cfg: TrackerConfig = { presenceIdleSec: 180, graceSec: 60 };
const t0 = 1_000_000;
const probe = (over: Partial<Probe>): Probe => ({
  now: t0, agentWorking: false, frontmost: true, inputIdleSec: 0, ...over,
});

function run(seq: Probe[]) {
  let s = initialState();
  const fx = [];
  for (const p of seq) { const r = tick(s, p, cfg); s = r.state; fx.push(r.effects); }
  return { s, fx };
}

describe("clocks", () => {
  test("agent working accrues agentMs even when absent", () => {
    const { s } = run([
      probe({ now: t0, agentWorking: true, frontmost: false, inputIdleSec: 999 }),
      probe({ now: t0 + 2000, agentWorking: true, frontmost: false, inputIdleSec: 999 }),
    ]);
    expect(s.agentMs).toBe(2000);
    expect(s.attendedMs).toBe(0);
    expect(s.phase).toBe("working");
  });

  test("present while agent works accrues both clocks", () => {
    const { s } = run([
      probe({ now: t0, agentWorking: true }),
      probe({ now: t0 + 2000, agentWorking: true }),
    ]);
    expect(s.agentMs).toBe(2000);
    expect(s.attendedMs).toBe(2000);
  });

  test("waiting + present accrues attended only", () => {
    const { s } = run([probe({ now: t0 }), probe({ now: t0 + 2000 })]);
    expect(s.attendedMs).toBe(2000);
    expect(s.agentMs).toBe(0);
    expect(s.phase).toBe("waiting");
  });

  test("first tick accrues nothing (no lastNow)", () => {
    const { s } = run([probe({ now: t0 })]);
    expect(s.attendedMs).toBe(0);
  });

  test("dt capped at 10s (machine slept)", () => {
    const { s } = run([probe({ now: t0 }), probe({ now: t0 + 120_000 })]);
    expect(s.attendedMs).toBe(10_000);
  });
});

describe("countdown and idle", () => {
  test("absence while waiting starts countdown with announcement", () => {
    const { s, fx } = run([
      probe({ now: t0 }),
      probe({ now: t0 + 2000, frontmost: false }),
    ]);
    expect(s.phase).toBe("countdown");
    expect(s.countdownEndsAt).toBe(t0 + 2000 + 60_000);
    expect(fx[1].say).toBe("going idle in one minute");
  });

  test("input-idle over threshold also starts countdown even if frontmost", () => {
    const { s } = run([
      probe({ now: t0 }),
      probe({ now: t0 + 2000, inputIdleSec: 200 }),
    ]);
    expect(s.phase).toBe("countdown");
  });

  test("says 5..1 in the final seconds, once each", () => {
    const seq = [probe({ now: t0 }), probe({ now: t0 + 1000, frontmost: false })];
    // countdown ends at t0+1000+60000; sample at remaining 5.5s, 5.2s, 4.1s
    seq.push(probe({ now: t0 + 1000 + 54_500, frontmost: false }));
    seq.push(probe({ now: t0 + 1000 + 54_800, frontmost: false }));
    seq.push(probe({ now: t0 + 1000 + 55_900, frontmost: false }));
    const { fx } = run(seq);
    expect(fx[2].say).toBe("5");
    expect(fx[3].say).toBeNull(); // 5 already said
    expect(fx[4].say).toBe("4");
  });

  test("countdown expiry goes idle with chime; grace counted as attended", () => {
    const { s, fx } = run([
      probe({ now: t0 }),
      probe({ now: t0 + 1000, frontmost: false }),           // countdown starts
      probe({ now: t0 + 1000 + 59_000, frontmost: false }),  // capped dt ticks…
      probe({ now: t0 + 1000 + 61_000, frontmost: false }),  // past end
    ]);
    expect(s.phase).toBe("idle");
    expect(fx[3].chime).toBe(true);
    expect(fx[3].becameIdle).toBe(true);
  });

  test("presence during countdown cancels it", () => {
    const { s, fx } = run([
      probe({ now: t0 }),
      probe({ now: t0 + 1000, frontmost: false }),
      probe({ now: t0 + 3000 }),
    ]);
    expect(s.phase).toBe("waiting");
    expect(s.countdownEndsAt).toBeNull();
    expect(fx[2].resumed).toBe(false); // never reached idle, no resume event
  });

  test("agent resuming during countdown cancels it", () => {
    const { s } = run([
      probe({ now: t0 }),
      probe({ now: t0 + 1000, frontmost: false }),
      probe({ now: t0 + 3000, agentWorking: true, frontmost: false }),
    ]);
    expect(s.phase).toBe("working");
  });

  test("return from idle emits resumed", () => {
    const { fx } = run([
      probe({ now: t0 }),
      probe({ now: t0 + 1000, frontmost: false }),
      probe({ now: t0 + 1000 + 61_000, frontmost: false }),
      probe({ now: t0 + 1000 + 63_000 }),
    ]);
    expect(fx[3].resumed).toBe(true);
  });

  test("idle accrues nothing", () => {
    const { s } = run([
      probe({ now: t0 }),
      probe({ now: t0 + 1000, frontmost: false }),
      probe({ now: t0 + 1000 + 61_000, frontmost: false }),
      probe({ now: t0 + 1000 + 63_000, frontmost: false }),
    ]);
    const attendedAtIdle = 1000 + 10_000; // 1s present + capped 10s grace tick
    expect(s.attendedMs).toBe(attendedAtIdle);
  });
});
