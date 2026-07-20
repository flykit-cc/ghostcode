// Pure keypress-attribution logic for the work tracker.
//
// The question this answers: "did the user just type into THIS window?"
// None of the raw signals answer it alone —
//   • keyboard idle (CGEvent) is machine-wide: it can't tell which window
//   • tty atime is per-window but pollutes on mouse/focus reporting bytes
//   • frontmost is app-wide: every Ghostty window is "front" together
// Combining them, with a settle window after focus changes, does.

export type AttributionProbe = {
  now: number;
  /** Ghostty is the frontmost app (already debounced by the caller). */
  front: boolean;
  /** Timestamp Ghostty became frontmost; null when it isn't. */
  frontSince: number | null;
  /** Seconds since the last key press, machine-wide. */
  kbIdleSec: number;
  /** Seconds since this window's tty consumed input; null when unknown. */
  ttyIdleSec: number | null;
};

/** A keypress must be at least this fresh to be considered "just now". */
export const KEYPRESS_FRESH_SEC = 2.5;
/** The tty must have seen bytes at least this recently. */
export const TTY_FRESH_SEC = 3;
/**
 * A keypress only counts once the window has held focus this long. Cmd+Tab
 * (and any focus-switch chord) registers as a key press at the instant focus
 * moves, so without this margin, switching INTO a window looks like typing
 * into it.
 */
export const FOCUS_SETTLE_MS = 750;

export function attributesKeypress(p: AttributionProbe): boolean {
  if (!p.front || p.frontSince === null) return false;
  if (!(p.kbIdleSec <= KEYPRESS_FRESH_SEC)) return false;
  if (p.ttyIdleSec !== null && p.ttyIdleSec > TTY_FRESH_SEC) return false;
  const keypressAt = p.now - p.kbIdleSec * 1000;
  return keypressAt >= p.frontSince + FOCUS_SETTLE_MS;
}
