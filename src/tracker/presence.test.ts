import { describe, test, expect } from "bun:test";
import { attributesKeypress, type AttributionProbe } from "./presence.ts";

const NOW = 1_000_000;
const base = (over: Partial<AttributionProbe> = {}): AttributionProbe => ({
  now: NOW,
  front: true,
  frontSince: NOW - 60_000, // focused a minute ago
  kbIdleSec: 0.5,
  ttyIdleSec: 0.5,
  ...over,
});

describe("attributesKeypress", () => {
  test("typing in the focused window counts", () => {
    expect(attributesKeypress(base())).toBe(true);
  });

  test("cmd+tab into the window does NOT count", () => {
    // The chord's key press lands right as focus moves: keypress timestamp
    // sits at (or just before) frontSince, and the focus-in bytes refresh
    // the tty at the same instant.
    expect(
      attributesKeypress(
        base({ frontSince: NOW - 1_000, kbIdleSec: 1.0, ttyIdleSec: 1.0 }),
      ),
    ).toBe(false);
  });

  test("typing shortly after a focus switch counts", () => {
    // Focused 5s ago, keypress 0.5s ago — clearly typed after arriving.
    expect(
      attributesKeypress(base({ frontSince: NOW - 5_000, kbIdleSec: 0.5 })),
    ).toBe(true);
  });

  test("hovering with no keypress does not count", () => {
    // Mouse reporting refreshes the tty, but no key was pressed.
    expect(attributesKeypress(base({ kbIdleSec: 45, ttyIdleSec: 0 }))).toBe(
      false,
    );
  });

  test("typing in another Ghostty window does not count", () => {
    // App is frontmost (app-wide signal) but THIS window's tty is stale.
    expect(attributesKeypress(base({ ttyIdleSec: 120 }))).toBe(false);
  });

  test("typing while Ghostty is backgrounded does not count", () => {
    expect(attributesKeypress(base({ front: false, frontSince: null }))).toBe(
      false,
    );
  });

  test("stale keypress does not count", () => {
    expect(attributesKeypress(base({ kbIdleSec: 30 }))).toBe(false);
  });

  test("unknown tty (no tty for the session) still allows attribution", () => {
    expect(attributesKeypress(base({ ttyIdleSec: null }))).toBe(true);
  });
});
