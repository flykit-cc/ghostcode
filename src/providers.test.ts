import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { loadProviders } from "./providers.ts";
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CONFIG_DIR = join(homedir(), ".config/ghostcode");
const CONFIG_PATH = join(CONFIG_DIR, "providers.json");
const BACKUP_PATH = join(CONFIG_DIR, "providers.json.bak");

describe("loadProviders", () => {
  beforeEach(() => {
    // Back up any existing providers.json so we don't clobber user state.
    if (existsSync(CONFIG_PATH)) {
      writeFileSync(BACKUP_PATH, readFileSync(CONFIG_PATH));
      rmSync(CONFIG_PATH);
    }
  });

  afterEach(() => {
    rmSync(CONFIG_PATH, { force: true });
    if (existsSync(BACKUP_PATH)) {
      writeFileSync(CONFIG_PATH, readFileSync(BACKUP_PATH));
      rmSync(BACKUP_PATH);
    }
  });

  test("writes defaults when config missing", () => {
    const providers = loadProviders();
    expect(providers.length).toBeGreaterThan(0);
    expect(providers[0].id).toBe("claude-oauth");
    expect(existsSync(CONFIG_PATH)).toBe(true);
  });

  test("falls back to defaults when config is malformed", () => {
    mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(CONFIG_PATH, "{not json");
    const providers = loadProviders();
    expect(providers[0].id).toBe("claude-oauth");
  });

  test("uses config contents when valid", () => {
    mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(
      CONFIG_PATH,
      JSON.stringify([
        { id: "custom", label: "Custom", env: {} },
      ]),
    );
    const providers = loadProviders();
    expect(providers).toEqual([{ id: "custom", label: "Custom", env: {} }]);
  });
});
