// Spawns the NVIDIA proxy as a child process and waits for it to bind a port.
// Used by launch.ts when a provider with `proxy: "nvidia"` is selected.
//
// Resolves which proxy entrypoint to run:
//   - production:  dist/nvidia-proxy.js   (via node)
//   - dev:         src/nvidia/proxy.ts    (via bun)

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type ProxyHandle = {
  port: number;
  child: ChildProcess;
  stop: () => void;
};

function resolveEntrypoint(): { cmd: string; script: string } {
  // process.argv[1] points at the running script: dist/ghostcode.js in
  // production, src/index.tsx in dev. Look for a sibling proxy first.
  const argvScript = process.argv[1];
  if (argvScript) {
    const siblingProd = join(dirname(argvScript), "nvidia-proxy.js");
    if (existsSync(siblingProd)) {
      return { cmd: process.execPath, script: siblingProd };
    }
  }

  // Dev fallback: resolve src/nvidia/proxy.ts relative to this module.
  const here = fileURLToPath(import.meta.url);
  const devTs = join(dirname(here), "proxy.ts");
  if (existsSync(devTs)) {
    return { cmd: "bun", script: devTs };
  }

  throw new Error(
    "nvidia proxy script not found (looked for dist/nvidia-proxy.js and src/nvidia/proxy.ts)",
  );
}

export function spawnNvidiaProxy(opts: {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
}): Promise<ProxyHandle> {
  const { cmd, script } = resolveEntrypoint();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NVIDIA_API_KEY: opts.apiKey,
    NVIDIA_PROXY_PORT: "0",
  };
  if (opts.baseUrl) env.NVIDIA_BASE_URL = opts.baseUrl;

  const child = spawn(cmd, [script], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const timeoutMs = opts.timeoutMs ?? 5000;

  return new Promise<ProxyHandle>((resolve, reject) => {
    let settled = false;
    let stdoutBuf = "";
    let stderrBuf = "";
    const onSettle = () => {
      child.stdout?.removeListener("data", onStdout);
      child.stderr?.removeListener("data", onStderr);
      child.removeListener("error", onError);
      child.removeListener("exit", onExit);
      clearTimeout(timer);
      // Free pre-ready buffers — we don't need them after settling.
      stdoutBuf = "";
      stderrBuf = "";
    };

    const onStdout = (chunk: Buffer) => {
      // Accumulate across chunks: READY could arrive split across two reads.
      stdoutBuf += chunk.toString("utf8");
      const m = stdoutBuf.match(/READY\s+(\d+)/);
      if (m && !settled) {
        settled = true;
        onSettle();
        const port = Number(m[1]);
        // Pipe further proxy stdout to our stderr so it's visible but doesn't
        // interfere with claude's stdout.
        child.stdout?.on("data", (c: Buffer) => {
          process.stderr.write(`[nvidia-proxy] ${c}`);
        });
        resolve({
          port,
          child,
          stop: () => {
            try {
              child.kill("SIGTERM");
            } catch {
              // already dead
            }
          },
        });
      }
    };

    const onStderr = (chunk: Buffer) => {
      const s = chunk.toString("utf8");
      stderrBuf += s;
      if (settled) process.stderr.write(`[nvidia-proxy] ${s}`);
    };

    const onError = (err: Error) => {
      if (settled) return;
      settled = true;
      onSettle();
      reject(new Error(`failed to spawn nvidia proxy: ${err.message}`));
    };

    const onExit = (code: number | null) => {
      if (settled) return;
      settled = true;
      const tail = stderrBuf.trim() || "no stderr";
      onSettle();
      reject(
        new Error(
          `nvidia proxy exited before ready (code ${code ?? "null"}): ${tail}`,
        ),
      );
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      const tail = stderrBuf.trim() || "no stderr";
      onSettle();
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
      reject(
        new Error(
          `nvidia proxy did not become ready within ${timeoutMs}ms: ${tail}`,
        ),
      );
    }, timeoutMs);

    child.stdout?.on("data", onStdout);
    child.stderr?.on("data", onStderr);
    child.on("error", onError);
    child.on("exit", onExit);
  });
}
