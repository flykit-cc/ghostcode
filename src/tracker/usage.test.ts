import { describe, test, expect } from "bun:test";
import { parseLastUsage } from "./usage.ts";

const line = (u: object) => JSON.stringify({ type: "assistant", message: { usage: u } });

describe("parseLastUsage", () => {
  test("parses a full usage object incl. nested cache_creation", () => {
    const tail = line({
      input_tokens: 120,
      cache_creation_input_tokens: 2100,
      cache_read_input_tokens: 51_000,
      cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 2100 },
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
