import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseLastUsage, readTranscriptTail } from "./usage.ts";

const line = (u: object) => JSON.stringify({ type: "assistant", message: { usage: u } });

describe("parseLastUsage", () => {
  test("parses a full usage object incl. nested cache_creation", () => {
    const tail = line({
      input_tokens: 120,
      cache_creation_input_tokens: 2100,
      cache_read_input_tokens: 51_000,
      cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 9999 },
      output_tokens: 900,
    });
    expect(parseLastUsage(tail)).toEqual({
      input: 120, output: 900, cache_read: 51_000, cache_write: 2100,
    });
  });

  test("takes the LAST usage entry", () => {
    const tail =
      line({ input_tokens: 1, output_tokens: 1 }) + "\n" +
      line({ input_tokens: 7, output_tokens: 9 });
    expect(parseLastUsage(tail)?.output).toBe(9);
  });

  test("missing fields default to 0", () => {
    const tail = line({ output_tokens: 5 });
    expect(parseLastUsage(tail)).toEqual({ input: 0, output: 5, cache_read: 0, cache_write: 0 });
  });

  test("no usage anywhere returns null", () => {
    expect(parseLastUsage('{"type":"user","text":"hi"}')).toBeNull();
  });
});

describe("readTranscriptTail", () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  test("nonexistent path returns \"\" (never throws)", () => {
    expect(() => readTranscriptTail("/nonexistent/path/does-not-exist.jsonl")).not.toThrow();
    expect(readTranscriptTail("/nonexistent/path/does-not-exist.jsonl")).toBe("");
  });

  test("reads a real temp file's content", () => {
    dir = mkdtempSync(join(tmpdir(), "usage-test-"));
    const path = join(dir, "transcript.jsonl");
    const content = line({ input_tokens: 3, output_tokens: 4 });
    writeFileSync(path, content);
    expect(readTranscriptTail(path)).toBe(content);
  });

  test("maxBytes truncation returns only the LAST maxBytes bytes", () => {
    dir = mkdtempSync(join(tmpdir(), "usage-test-"));
    const path = join(dir, "transcript.jsonl");
    // 26 bytes total; last 10 bytes should be "QRSTUVWXYZ"
    writeFileSync(path, "ABCDEFGHIJKLMNOPQRSTUVWXYZ");
    expect(readTranscriptTail(path, 10)).toBe("QRSTUVWXYZ");
  });
});
