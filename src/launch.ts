import { spawnSync } from "node:child_process";
import { getSecret } from "./keychain.ts";
import type { Provider } from "./providers.ts";
import { spawnNvidiaProxy, type ProxyHandle } from "./nvidia/spawn.ts";

export type PermissionMode =
  | "bypassPermissions"
  | "auto"
  | "acceptEdits"
  | "plan"
  | "default";

export type LaunchPlan = {
  projectPath: string;
  provider: Provider;
  secretValue?: string;
  // For Claude: "" = Opus default, "sonnet" = Sonnet.
  // For providers with a models list: concrete model id (or "" = first).
  model: string;
  effort: "default" | "low" | "medium" | "high" | "xhigh" | "max";
  mode: PermissionMode;
  openVSCode: boolean;
};

export async function runLaunch(plan: LaunchPlan): Promise<number> {
  const check = spawnSync("command", ["-v", "claude"], { encoding: "utf8" });
  if (check.status !== 0 || !check.stdout.trim()) {
    process.stderr.write(
      "\x1b[31mclaude not found.\x1b[0m Run: npm i -g @anthropic-ai/claude-code\n"
    );
    return 1;
  }

  const env: NodeJS.ProcessEnv = { ...process.env, ...plan.provider.env };
  if (plan.provider.secret && plan.secretValue) {
    env[plan.provider.secret.envVar] = plan.secretValue;
  }

  if (plan.provider.models?.length) {
    const modelId = plan.model || plan.provider.models[0].id;
    env.ANTHROPIC_MODEL = modelId;
  }

  if (plan.openVSCode) {
    spawnSync("open", ["-a", "Visual Studio Code", plan.projectPath], {
      stdio: "ignore",
    });
  }

  // Permission mode. bypassPermissions keeps using the shorthand flag because
  // it's the canonical way to opt into the insecure-but-fast path; other modes
  // go through --permission-mode. "default" means "Claude decides" — no flag.
  const args: string[] = [];
  if (plan.mode === "bypassPermissions") {
    args.push("--dangerously-skip-permissions");
  } else if (plan.mode !== "default") {
    args.push("--permission-mode", plan.mode);
  }

  if (plan.provider.supportsClaudeFlags) {
    if (plan.model === "sonnet") args.push("--model", "sonnet");
    if (plan.effort !== "default") args.push("--effort", plan.effort);
  }

  // Check for updates before launching. Output is visible so the user sees
  // "already up to date" or the update progress. Timeout-bounded so a
  // network hiccup doesn't stall the session.
  process.stdout.write("\x1b[90m$ claude update\x1b[0m\n");
  spawnSync("claude", ["update"], { stdio: "inherit", timeout: 15000 });
  process.stdout.write("\n");

  // For providers with a proxy: start it after `claude update` so a slow
  // update doesn't hold an idle port. Sets ANTHROPIC_BASE_URL to the proxy
  // and scrubs NVIDIA_API_KEY from the env claude inherits.
  let proxy: ProxyHandle | null = null;
  if (plan.provider.proxy === "nvidia") {
    if (!plan.secretValue) {
      process.stderr.write(
        "\x1b[31mNVIDIA_API_KEY missing.\x1b[0m Set it via Settings → API keys.\n",
      );
      return 1;
    }
    process.stdout.write("\x1b[90m$ nvidia-proxy starting...\x1b[0m\n");
    try {
      proxy = await spawnNvidiaProxy({ apiKey: plan.secretValue });
    } catch (e) {
      process.stderr.write(
        `\x1b[31mnvidia-proxy failed to start:\x1b[0m ${(e as Error).message}\n`,
      );
      return 1;
    }
    process.stdout.write(
      `\x1b[90m$ nvidia-proxy listening on 127.0.0.1:${proxy.port}\x1b[0m\n`,
    );
    env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${proxy.port}`;
    // Claude Code requires ANTHROPIC_AUTH_TOKEN; the proxy ignores it.
    env.ANTHROPIC_AUTH_TOKEN = "ghostcode-nvidia-proxy";
    delete env.NVIDIA_API_KEY;
  }

  const banner = `\x1b[90m$ claude ${args.join(" ")}\x1b[0m\n`;
  process.stdout.write(banner);

  const claude = spawnSync("claude", args, {
    stdio: "inherit",
    env,
    cwd: plan.projectPath,
  });

  // Tear down the proxy before dropping into the user's shell so the port
  // doesn't linger past the Claude session.
  if (proxy) proxy.stop();

  const zsh = spawnSync("zsh", [], {
    stdio: "inherit",
    env,
    cwd: plan.projectPath,
  });
  return zsh.status ?? claude.status ?? 0;
}

export function resolveSecret(provider: Provider): {
  ok: boolean;
  value?: string;
} {
  if (!provider.secret) return { ok: true };
  const v = getSecret(provider.secret.keychainService);
  return v ? { ok: true, value: v } : { ok: false };
}
