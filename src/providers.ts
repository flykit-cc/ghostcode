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
  // Marks providers that need a local translator proxy started before launch.
  // The launcher knows how to start each by id.
  proxy?: "nvidia";
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
      { id: "glm-5.2", label: "GLM-5.2" },
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
    label: "Kimi",
    sublabel: "Moonshot",
    env: {
      ANTHROPIC_BASE_URL: "https://api.moonshot.ai/anthropic",
    },
    secret: {
      envVar: "ANTHROPIC_AUTH_TOKEN",
      keychainService: "ghostcode.kimi",
    },
    models: [
      { id: "kimi-k3", label: "Kimi K3" },
      { id: "kimi-k2.7-code", label: "Kimi K2.7 Code" },
      { id: "kimi-k2.7-code-highspeed", label: "Kimi K2.7 Code Highspeed" },
      { id: "kimi-k2.6", label: "Kimi K2.6" },
    ],
  },
  {
    id: "qwen",
    label: "Qwen",
    sublabel: "DashScope",
    env: {
      ANTHROPIC_BASE_URL:
        "https://dashscope-intl.aliyuncs.com/api/v2/apps/claude-code-proxy/v1",
    },
    secret: {
      envVar: "ANTHROPIC_AUTH_TOKEN",
      keychainService: "ghostcode.qwen",
    },
    models: [
      { id: "qwen3-coder-plus", label: "Qwen3 Coder Plus" },
      { id: "qwen3.6-plus", label: "Qwen3.6 Plus" },
    ],
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    sublabel: "DeepSeek API",
    env: { ANTHROPIC_BASE_URL: "https://api.deepseek.com/anthropic" },
    secret: {
      envVar: "ANTHROPIC_AUTH_TOKEN",
      keychainService: "ghostcode.deepseek",
    },
    models: [
      { id: "deepseek-reasoner", label: "DeepSeek Reasoner" },
      { id: "deepseek-chat", label: "DeepSeek Chat" },
    ],
  },
  {
    id: "minimax",
    label: "MiniMax",
    sublabel: "minimax.io",
    env: { ANTHROPIC_BASE_URL: "https://api.minimax.io/anthropic" },
    secret: {
      envVar: "ANTHROPIC_AUTH_TOKEN",
      keychainService: "ghostcode.minimax",
    },
    models: [{ id: "minimax-m2.7", label: "MiniMax M2.7" }],
  },
  {
    id: "nvidia",
    label: "NVIDIA NIM",
    sublabel: "via local translator proxy",
    // ANTHROPIC_BASE_URL is filled in at launch time once the proxy
    // has bound a free port. The key is read from Keychain and forwarded
    // to the proxy as NVIDIA_API_KEY (NOT as an Anthropic auth token).
    env: {},
    secret: {
      envVar: "NVIDIA_API_KEY",
      keychainService: "ghostcode.nvidia",
    },
    proxy: "nvidia",
    // Pruned to models verified working with the standard NVIDIA developer
    // key. DeepSeek V3.1+/V4, Mistral, smaller Qwen, and Nemotron Ultra all
    // either 404 ("function not provisioned for account") or silently hang
    // because the account lacks entitlement. Re-add them by hand if your
    // org has access. First entry is the wizard default.
    models: [
      {
        id: "qwen/qwen3-coder-480b-a35b-instruct",
        label: "Qwen3 Coder 480B",
      },
      { id: "meta/llama-3.3-70b-instruct", label: "Llama 3.3 70B Instruct" },
      {
        id: "meta/llama-3.1-405b-instruct",
        label: "Llama 3.1 405B Instruct",
      },
      { id: "meta/llama-3.1-70b-instruct", label: "Llama 3.1 70B Instruct" },
      {
        id: "qwen/qwen3-next-80b-a3b-thinking",
        label: "Qwen3 Next 80B Thinking",
      },
      {
        id: "nvidia/llama-3.3-nemotron-super-49b-v1",
        label: "Nemotron Super 49B",
      },
    ],
  },
];

// Merge built-in updates into the user's file:
//   - Append built-in providers missing entirely from the user's file.
//   - For built-in providers the user has, append any new built-in models
//     not present by id. User-added models and reordering are preserved;
//     models the user explicitly removed stay removed only if they're not
//     in the built-in list (we re-add new built-ins, never re-add ones the
//     user removed and that no longer ship by default).
function mergeBuiltins(user: Provider[]): {
  merged: Provider[];
  changed: boolean;
} {
  let changed = false;
  const builtinById = new Map(DEFAULT_PROVIDERS.map((p) => [p.id, p]));
  const merged = user.map((p) => {
    const builtin = builtinById.get(p.id);
    if (!builtin || !builtin.models?.length) return p;
    const userModelIds = new Set(p.models?.map((m) => m.id) ?? []);
    const newModels = builtin.models.filter((m) => !userModelIds.has(m.id));
    if (newModels.length === 0) return p;
    changed = true;
    return { ...p, models: [...(p.models ?? []), ...newModels] };
  });
  const haveIds = new Set(user.map((p) => p.id));
  const missingProviders = DEFAULT_PROVIDERS.filter((p) => !haveIds.has(p.id));
  if (missingProviders.length > 0) {
    changed = true;
    merged.push(...missingProviders);
  }
  return { merged, changed };
}

export function loadProviders(): Provider[] {
  if (existsSync(CONFIG_PATH)) {
    try {
      const user = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Provider[];
      const { merged, changed } = mergeBuiltins(user);
      if (changed) {
        try {
          writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2));
        } catch {
          // best-effort persist; runtime list is still correct
        }
      }
      return merged;
    } catch {
      // fall through to defaults if the file is malformed
    }
  }
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_PROVIDERS, null, 2));
  return DEFAULT_PROVIDERS;
}
