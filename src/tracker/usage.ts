import { closeSync, fstatSync, openSync, readSync } from "node:fs";

export type TurnTokens = {
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
};

// Matches "usage":{...} allowing ONE level of nested braces (cache_creation).
const USAGE_RE = /"usage":\{(?:[^{}]|\{[^{}]*\})*\}/g;

export function parseLastUsage(tail: string): TurnTokens | null {
  const matches = tail.match(USAGE_RE);
  if (!matches) return null;
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i];
    if (!m.includes('"output_tokens"')) continue;
    const num = (key: string) => {
      const r = new RegExp(`"${key}":(\\d+)`).exec(m);
      return r ? +r[1] : 0;
    };
    return {
      input: num("input_tokens"),
      output: num("output_tokens"),
      cache_read: num("cache_read_input_tokens"),
      cache_write: num("cache_creation_input_tokens"),
    };
  }
  return null;
}

export function readTranscriptTail(transcriptPath: string, maxBytes = 256 * 1024): string {
  try {
    const fd = openSync(transcriptPath, "r");
    try {
      const size = fstatSync(fd).size;
      const len = Math.min(size, maxBytes);
      const buf = Buffer.alloc(len);
      readSync(fd, buf, 0, len, size - len);
      return buf.toString("utf8");
    } finally {
      closeSync(fd);
    }
  } catch {
    return "";
  }
}
