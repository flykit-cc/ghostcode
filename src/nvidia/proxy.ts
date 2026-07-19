// Node-compatible HTTP server that proxies Anthropic /v1/messages to NVIDIA
// NIM's OpenAI-compatible /v1/chat/completions endpoint, translating in both
// directions. Spawned as a child process by launch.ts.
//
// Reads from env:
//   NVIDIA_API_KEY     — required, the user's NVIDIA API key
//   NVIDIA_PROXY_PORT  — optional integer; 0 or unset means "pick free"
//   NVIDIA_BASE_URL    — optional override, defaults to NVIDIA cloud
//
// Emits a single line `READY <port>` to stdout once listening.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  StreamTranslator,
  TranslationError,
  anthropicToOpenAIRequest,
  openAIToAnthropicResponse,
  serializeSseEvent,
  type AnthropicRequest,
  type OpenAIResponse,
} from "./translate.ts";

const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY ?? "";
const NVIDIA_BASE_URL =
  process.env.NVIDIA_BASE_URL ?? "https://integrate.api.nvidia.com/v1";
const REQUESTED_PORT = Number(process.env.NVIDIA_PROXY_PORT ?? "0");
// NVIDIA's gateway sometimes accepts a request and never responds when the
// caller's key lacks entitlement for the requested model. Without a timeout
// the user sees Claude Code freeze indefinitely; with one they get a clear
// 504 they can act on. 90s is generous for cold-start first-token.
const UPSTREAM_TIMEOUT_MS = Number(
  process.env.NVIDIA_UPSTREAM_TIMEOUT_MS ?? "90000",
);

if (!NVIDIA_API_KEY) {
  process.stderr.write(
    "[nvidia-proxy] NVIDIA_API_KEY not set; refusing to start.\n",
  );
  process.exit(2);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJsonError(res: ServerResponse, status: number, message: string) {
  const body = JSON.stringify({
    type: "error",
    error: { type: "proxy_error", message },
  });
  res.writeHead(status, { "content-type": "application/json" });
  res.end(body);
}

async function handleMessages(req: IncomingMessage, res: ServerResponse) {
  const raw = await readBody(req);
  let body: AnthropicRequest;
  try {
    body = JSON.parse(raw) as AnthropicRequest;
  } catch {
    return sendJsonError(res, 400, "invalid JSON body");
  }

  let openaiReq;
  try {
    openaiReq = anthropicToOpenAIRequest(body);
  } catch (e) {
    if (e instanceof TranslationError) {
      return sendJsonError(res, e.status, e.message);
    }
    return sendJsonError(res, 500, (e as Error).message);
  }

  const upstreamUrl = `${NVIDIA_BASE_URL.replace(/\/$/, "")}/chat/completions`;
  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${NVIDIA_API_KEY}`,
        accept: body.stream ? "text/event-stream" : "application/json",
      },
      body: JSON.stringify(openaiReq),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (e) {
    const err = e as Error;
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      // Use 400 (not 504) so Claude Code treats this as terminal instead of
      // retrying 10x. The hang is deterministic for the given key+model;
      // retries don't help and just bury the user in a multi-minute spinner.
      return sendJsonError(
        res,
        400,
        `NVIDIA upstream did not respond within ${UPSTREAM_TIMEOUT_MS}ms for model ${body.model}. The API key likely lacks entitlement for that model — pick a different one (try meta/llama-3.3-70b-instruct).`,
      );
    }
    return sendJsonError(res, 502, `upstream fetch failed: ${err.message}`);
  }

  if (!upstream.ok) {
    const text = await upstream.text();
    return sendJsonError(
      res,
      upstream.status,
      `upstream ${upstream.status}: ${text.slice(0, 500)}`,
    );
  }

  if (!body.stream) {
    const json = (await upstream.json()) as OpenAIResponse;
    let translated;
    try {
      translated = openAIToAnthropicResponse(json, body.model);
    } catch (e) {
      if (e instanceof TranslationError) {
        return sendJsonError(res, e.status, e.message);
      }
      return sendJsonError(res, 500, (e as Error).message);
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(translated));
    return;
  }

  // Streaming path: read upstream SSE line-by-line, feed the translator,
  // write Anthropic SSE frames out as they arrive.
  if (!upstream.body) return sendJsonError(res, 502, "upstream returned no body");

  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });

  const translator = new StreamTranslator(body.model);
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const onClientClose = () => {
    reader.cancel().catch(() => {});
  };
  res.on("close", onClientClose);

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nlIdx;
      while ((nlIdx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nlIdx).trim();
        buffer = buffer.slice(nlIdx + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") continue;
        let chunk;
        try {
          chunk = JSON.parse(payload);
        } catch {
          continue;
        }
        const events = translator.push(chunk);
        for (const e of events) {
          res.write(serializeSseEvent(e));
        }
      }
    }
  } catch (e) {
    process.stderr.write(
      `[nvidia-proxy] stream error: ${(e as Error).message}\n`,
    );
  } finally {
    res.end();
  }
}

// Claude Code calls POST /v1/messages/count_tokens before each request.
// NVIDIA NIM doesn't expose a token-count endpoint, so we return a rough
// estimate (~4 chars per token across all stringified content). The number
// only needs to be plausible — Claude Code uses it for context-window
// budgeting, not billing.
async function handleCountTokens(req: IncomingMessage, res: ServerResponse) {
  const raw = await readBody(req);
  let approx = 0;
  try {
    const body = JSON.parse(raw);
    approx = Math.ceil(JSON.stringify(body).length / 4);
  } catch {
    approx = Math.ceil(raw.length / 4);
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ input_tokens: approx }));
}

async function handleModels(res: ServerResponse) {
  const upstreamUrl = `${NVIDIA_BASE_URL.replace(/\/$/, "")}/models`;
  try {
    const upstream = await fetch(upstreamUrl, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${NVIDIA_API_KEY}`,
      },
    });
    const text = await upstream.text();
    res.writeHead(upstream.status, {
      "content-type":
        upstream.headers.get("content-type") ?? "application/json",
    });
    res.end(text);
  } catch (e) {
    sendJsonError(res, 502, `upstream fetch failed: ${(e as Error).message}`);
  }
}

// Strip query string + trailing slash so betas like `?beta=...` and
// inconsistent trailing slashes still hit the right route.
function pathOf(url: string): string {
  const q = url.indexOf("?");
  let p = q === -1 ? url : url.slice(0, q);
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p;
}

const server = createServer((req, res) => {
  const url = req.url ?? "";
  const path = pathOf(url);
  if (req.method === "GET" && path === "/health") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
    return;
  }
  if (req.method === "GET" && path === "/v1/models") {
    handleModels(res).catch((e) => {
      if (!res.headersSent) sendJsonError(res, 500, (e as Error).message);
      else res.end();
    });
    return;
  }
  if (req.method === "POST" && path === "/v1/messages/count_tokens") {
    handleCountTokens(req, res).catch((e) => {
      if (!res.headersSent) sendJsonError(res, 500, (e as Error).message);
      else res.end();
    });
    return;
  }
  if (req.method === "POST" && path === "/v1/messages") {
    handleMessages(req, res).catch((e) => {
      process.stderr.write(
        `[nvidia-proxy] handler error: ${(e as Error).message}\n`,
      );
      if (!res.headersSent) sendJsonError(res, 500, (e as Error).message);
      else res.end();
    });
    return;
  }
  process.stderr.write(`[nvidia-proxy] 404 ${req.method} ${url}\n`);
  sendJsonError(res, 404, `not found: ${req.method} ${url}`);
});

const startPort = Number.isFinite(REQUESTED_PORT) && REQUESTED_PORT > 0
  ? REQUESTED_PORT
  : 0;
server.listen(startPort, "127.0.0.1", () => {
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : startPort;
  process.stdout.write(`READY ${port}\n`);
});

const shutdown = () => {
  server.close(() => process.exit(0));
  // Hard exit if close hangs.
  setTimeout(() => process.exit(0), 500).unref();
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
