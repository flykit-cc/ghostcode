import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type ProviderModel = { id: string; label: string };

export type Provider = {
  id: string;
  label: string;
  sublabel?: string;
  env: Record<string, string>;
  secret?: { envVar: string; keychainService: string };
  // Only Claude (Opus 4.7+) supports --effort and --model sonnet/opus flags.
  supportsClaudeFlags?: boolean;
  // Non-Claude providers with a selectable model list. Sets ANTHROPIC_MODEL.
  // First item is the default.
  models?: ProviderModel[];
};

const CONFIG_PATH = join(homedir(), ".config/ghostcode/providers.json");

const DEFAULT_PROVIDERS: Provider[] = [
  {
    id: "claude-oauth",
    label: "Claude",
    sublabel: "subscription (OAuth)",
    env: {},
    supportsClaudeFlags: true,
  },
  {
    id: "anthropic-api",
    label: "Anthropic",
    sublabel: "API key",
    env: {},
    secret: {
      envVar: "ANTHROPIC_API_KEY",
      keychainService: "ghostcode.anthropic-api",
    },
    supportsClaudeFlags: true,
  },
  {
    id: "glm",
    label: "GLM",
    sublabel: "Z.ai",
    env: { ANTHROPIC_BASE_URL: "https://api.z.ai/api/anthropic" },
    secret: {
      envVar: "ANTHROPIC_AUTH_TOKEN",
      keychainService: "ghostcode.glm",
    },
    models: [
      { id: "glm-5.1", label: "GLM-5.1" },
      { id: "glm-5", label: "GLM-5" },
      { id: "glm-5-turbo", label: "GLM-5-Turbo" },
      { id: "glm-4.7", label: "GLM-4.7" },
      { id: "glm-4.6", label: "GLM-4.6" },
      { id: "glm-4.5", label: "GLM-4.5" },
    ],
  },
  {
    id: "kimi",
    label: "Kimi K2",
    sublabel: "Moonshot",
    env: {
      ANTHROPIC_BASE_URL: "https://api.moonshot.ai/anthropic",
      ANTHROPIC_MODEL: "kimi-k2-turbo-preview",
    },
    secret: {
      envVar: "ANTHROPIC_AUTH_TOKEN",
      keychainService: "ghostcode.kimi",
    },
  },
  {
    id: "qwen",
    label: "Qwen3 Coder",
    sublabel: "DashScope",
    env: {
      ANTHROPIC_BASE_URL:
        "https://dashscope-intl.aliyuncs.com/api/v2/apps/claude-code-proxy/v1",
      ANTHROPIC_MODEL: "qwen3-coder-plus",
    },
    secret: {
      envVar: "ANTHROPIC_AUTH_TOKEN",
      keychainService: "ghostcode.qwen",
    },
  },
];

export function loadProviders(): Provider[] {
  if (existsSync(CONFIG_PATH)) {
    try {
      return JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Provider[];
    } catch {
      // fall through to defaults if the file is malformed
    }
  }
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_PROVIDERS, null, 2));
  return DEFAULT_PROVIDERS;
}
