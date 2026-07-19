// src/nvidia/proxy.ts
import { createServer } from "node:http";

// src/nvidia/translate.ts
class TranslationError extends Error {
  status;
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
function systemToString(sys) {
  if (!sys)
    return null;
  if (typeof sys === "string")
    return sys;
  return sys.map((b) => b.text).join(`
`);
}
function toolResultContentToString(c) {
  if (typeof c === "string")
    return c;
  return c.filter((b) => b && b.type === "text" && typeof b.text === "string").map((b) => b.text).join("");
}
function rejectUnsupportedBlock(block) {
  throw new TranslationError(`Content block type "${block.type}" is not supported by the NVIDIA proxy. ` + `Supported: text, tool_use, tool_result.`);
}
function anthropicToOpenAIRequest(req, modelOverride) {
  const out = [];
  const sys = systemToString(req.system);
  if (sys && sys.length > 0)
    out.push({ role: "system", content: sys });
  for (const msg of req.messages) {
    if (typeof msg.content === "string") {
      if (msg.role === "assistant") {
        out.push({ role: "assistant", content: msg.content });
      } else {
        out.push({ role: "user", content: msg.content });
      }
      continue;
    }
    if (msg.role === "assistant") {
      let text = "";
      const toolCalls = [];
      for (const block of msg.content) {
        if (block.type === "text") {
          text += block.text;
        } else if (block.type === "tool_use") {
          toolCalls.push({
            id: block.id,
            type: "function",
            function: {
              name: block.name,
              arguments: JSON.stringify(block.input ?? {})
            }
          });
        } else if (block.type === "tool_result") {
          continue;
        } else {
          rejectUnsupportedBlock(block);
        }
      }
      const assistantMsg = {
        role: "assistant",
        content: text.length > 0 ? text : null
      };
      if (toolCalls.length > 0) {
        assistantMsg.tool_calls = toolCalls;
      }
      out.push(assistantMsg);
      continue;
    }
    const textParts = [];
    const toolMessages = [];
    for (const block of msg.content) {
      if (block.type === "text") {
        textParts.push(block.text);
      } else if (block.type === "tool_result") {
        toolMessages.push({
          role: "tool",
          tool_call_id: block.tool_use_id,
          content: toolResultContentToString(block.content)
        });
      } else if (block.type === "tool_use") {
        continue;
      } else {
        rejectUnsupportedBlock(block);
      }
    }
    out.push(...toolMessages);
    if (textParts.length > 0) {
      out.push({ role: "user", content: textParts.join("") });
    }
  }
  const openai = {
    model: modelOverride ?? req.model,
    messages: out
  };
  if (req.max_tokens !== undefined)
    openai.max_tokens = req.max_tokens;
  if (req.temperature !== undefined)
    openai.temperature = req.temperature;
  if (req.top_p !== undefined)
    openai.top_p = req.top_p;
  if (req.stop_sequences && req.stop_sequences.length > 0) {
    openai.stop = req.stop_sequences;
  }
  if (req.stream) {
    openai.stream = true;
    openai.stream_options = { include_usage: true };
  }
  if (req.tools && req.tools.length > 0) {
    openai.tools = req.tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema
      }
    }));
  }
  if (req.tool_choice) {
    if (req.tool_choice.type === "auto")
      openai.tool_choice = "auto";
    else if (req.tool_choice.type === "none")
      openai.tool_choice = "none";
    else if (req.tool_choice.type === "any")
      openai.tool_choice = "required";
    else if (req.tool_choice.type === "tool") {
      openai.tool_choice = {
        type: "function",
        function: { name: req.tool_choice.name }
      };
    }
  }
  return openai;
}
function mapFinishReason(r) {
  switch (r) {
    case "stop":
      return "end_turn";
    case "length":
      return "max_tokens";
    case "tool_calls":
      return "tool_use";
    case "content_filter":
      return "end_turn";
    default:
      return null;
  }
}
function openAIToAnthropicResponse(resp, anthropicModel) {
  const choice = resp.choices[0];
  if (!choice) {
    throw new TranslationError("Upstream returned no choices", 502);
  }
  const content = [];
  if (choice.message.content && choice.message.content.length > 0) {
    content.push({ type: "text", text: choice.message.content });
  }
  if (choice.message.tool_calls) {
    for (const tc of choice.message.tool_calls) {
      let input = {};
      try {
        input = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
      } catch {
        input = { _raw: tc.function.arguments };
      }
      content.push({
        type: "tool_use",
        id: tc.id,
        name: tc.function.name,
        input
      });
    }
  }
  return {
    id: resp.id,
    type: "message",
    role: "assistant",
    model: anthropicModel,
    content,
    stop_reason: mapFinishReason(choice.finish_reason),
    stop_sequence: null,
    usage: {
      input_tokens: resp.usage?.prompt_tokens ?? 0,
      output_tokens: resp.usage?.completion_tokens ?? 0
    }
  };
}

class StreamTranslator {
  model;
  messageStarted = false;
  currentBlockIndex = -1;
  currentBlockKind = null;
  toolIndexMap = new Map;
  nextBlockIndex = 0;
  finished = false;
  usage = {
    input_tokens: 0,
    output_tokens: 0
  };
  upstreamId = "";
  constructor(anthropicModel) {
    this.model = anthropicModel;
  }
  push(chunk) {
    const events = [];
    if (chunk.id && !this.upstreamId)
      this.upstreamId = chunk.id;
    if (!this.messageStarted) {
      this.messageStarted = true;
      events.push({
        event: "message_start",
        data: {
          type: "message_start",
          message: {
            id: this.upstreamId || `msg_${Date.now()}`,
            type: "message",
            role: "assistant",
            content: [],
            model: this.model,
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 0, output_tokens: 0 }
          }
        }
      });
    }
    if (chunk.usage) {
      this.usage = {
        input_tokens: chunk.usage.prompt_tokens,
        output_tokens: chunk.usage.completion_tokens
      };
    }
    const choice = chunk.choices?.[0];
    if (!choice)
      return events;
    const delta = choice.delta ?? {};
    if (typeof delta.content === "string" && delta.content.length > 0) {
      if (this.currentBlockKind !== "text") {
        if (this.currentBlockKind !== null) {
          events.push(this.closeCurrentBlock());
        }
        this.currentBlockIndex = this.nextBlockIndex++;
        this.currentBlockKind = "text";
        events.push({
          event: "content_block_start",
          data: {
            type: "content_block_start",
            index: this.currentBlockIndex,
            content_block: { type: "text", text: "" }
          }
        });
      }
      events.push({
        event: "content_block_delta",
        data: {
          type: "content_block_delta",
          index: this.currentBlockIndex,
          delta: { type: "text_delta", text: delta.content }
        }
      });
    }
    if (delta.tool_calls && delta.tool_calls.length > 0) {
      for (const tc of delta.tool_calls) {
        const isStart = tc.id !== undefined;
        if (isStart) {
          if (this.currentBlockKind !== null) {
            events.push(this.closeCurrentBlock());
          }
          this.currentBlockIndex = this.nextBlockIndex++;
          this.currentBlockKind = "tool_use";
          this.toolIndexMap.set(tc.index, this.currentBlockIndex);
          events.push({
            event: "content_block_start",
            data: {
              type: "content_block_start",
              index: this.currentBlockIndex,
              content_block: {
                type: "tool_use",
                id: tc.id,
                name: tc.function?.name ?? "",
                input: {}
              }
            }
          });
          if (tc.function?.arguments && tc.function.arguments.length > 0) {
            events.push({
              event: "content_block_delta",
              data: {
                type: "content_block_delta",
                index: this.currentBlockIndex,
                delta: {
                  type: "input_json_delta",
                  partial_json: tc.function.arguments
                }
              }
            });
          }
        } else if (tc.function?.arguments && tc.function.arguments.length > 0) {
          const idx = this.toolIndexMap.get(tc.index);
          if (idx !== undefined) {
            events.push({
              event: "content_block_delta",
              data: {
                type: "content_block_delta",
                index: idx,
                delta: {
                  type: "input_json_delta",
                  partial_json: tc.function.arguments
                }
              }
            });
          }
        }
      }
    }
    if (choice.finish_reason && !this.finished) {
      this.finished = true;
      if (this.currentBlockKind !== null) {
        events.push(this.closeCurrentBlock());
      }
      events.push({
        event: "message_delta",
        data: {
          type: "message_delta",
          delta: {
            stop_reason: mapFinishReason(choice.finish_reason),
            stop_sequence: null
          },
          usage: { output_tokens: this.usage.output_tokens }
        }
      });
      events.push({ event: "message_stop", data: { type: "message_stop" } });
    }
    return events;
  }
  closeCurrentBlock() {
    const idx = this.currentBlockIndex;
    this.currentBlockKind = null;
    this.currentBlockIndex = -1;
    return {
      event: "content_block_stop",
      data: { type: "content_block_stop", index: idx }
    };
  }
}
function serializeSseEvent(e) {
  return `event: ${e.event}
data: ${JSON.stringify(e.data)}

`;
}

// src/nvidia/proxy.ts
var NVIDIA_API_KEY = process.env.NVIDIA_API_KEY ?? "";
var NVIDIA_BASE_URL = process.env.NVIDIA_BASE_URL ?? "https://integrate.api.nvidia.com/v1";
var REQUESTED_PORT = Number(process.env.NVIDIA_PROXY_PORT ?? "0");
var UPSTREAM_TIMEOUT_MS = Number(process.env.NVIDIA_UPSTREAM_TIMEOUT_MS ?? "90000");
if (!NVIDIA_API_KEY) {
  process.stderr.write(`[nvidia-proxy] NVIDIA_API_KEY not set; refusing to start.
`);
  process.exit(2);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
function sendJsonError(res, status, message) {
  const body = JSON.stringify({
    type: "error",
    error: { type: "proxy_error", message }
  });
  res.writeHead(status, { "content-type": "application/json" });
  res.end(body);
}
async function handleMessages(req, res) {
  const raw = await readBody(req);
  let body;
  try {
    body = JSON.parse(raw);
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
    return sendJsonError(res, 500, e.message);
  }
  const upstreamUrl = `${NVIDIA_BASE_URL.replace(/\/$/, "")}/chat/completions`;
  let upstream;
  try {
    upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${NVIDIA_API_KEY}`,
        accept: body.stream ? "text/event-stream" : "application/json"
      },
      body: JSON.stringify(openaiReq),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
    });
  } catch (e) {
    const err = e;
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      return sendJsonError(res, 400, `NVIDIA upstream did not respond within ${UPSTREAM_TIMEOUT_MS}ms for model ${body.model}. The API key likely lacks entitlement for that model — pick a different one (try meta/llama-3.3-70b-instruct).`);
    }
    return sendJsonError(res, 502, `upstream fetch failed: ${err.message}`);
  }
  if (!upstream.ok) {
    const text = await upstream.text();
    return sendJsonError(res, upstream.status, `upstream ${upstream.status}: ${text.slice(0, 500)}`);
  }
  if (!body.stream) {
    const json = await upstream.json();
    let translated;
    try {
      translated = openAIToAnthropicResponse(json, body.model);
    } catch (e) {
      if (e instanceof TranslationError) {
        return sendJsonError(res, e.status, e.message);
      }
      return sendJsonError(res, 500, e.message);
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(translated));
    return;
  }
  if (!upstream.body)
    return sendJsonError(res, 502, "upstream returned no body");
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive"
  });
  const translator = new StreamTranslator(body.model);
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder;
  let buffer = "";
  const onClientClose = () => {
    reader.cancel().catch(() => {});
  };
  res.on("close", onClientClose);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done)
        break;
      buffer += decoder.decode(value, { stream: true });
      let nlIdx;
      while ((nlIdx = buffer.indexOf(`
`)) !== -1) {
        const line = buffer.slice(0, nlIdx).trim();
        buffer = buffer.slice(nlIdx + 1);
        if (!line.startsWith("data:"))
          continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]")
          continue;
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
    process.stderr.write(`[nvidia-proxy] stream error: ${e.message}
`);
  } finally {
    res.end();
  }
}
async function handleCountTokens(req, res) {
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
async function handleModels(res) {
  const upstreamUrl = `${NVIDIA_BASE_URL.replace(/\/$/, "")}/models`;
  try {
    const upstream = await fetch(upstreamUrl, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${NVIDIA_API_KEY}`
      }
    });
    const text = await upstream.text();
    res.writeHead(upstream.status, {
      "content-type": upstream.headers.get("content-type") ?? "application/json"
    });
    res.end(text);
  } catch (e) {
    sendJsonError(res, 502, `upstream fetch failed: ${e.message}`);
  }
}
function pathOf(url) {
  const q = url.indexOf("?");
  let p = q === -1 ? url : url.slice(0, q);
  if (p.length > 1 && p.endsWith("/"))
    p = p.slice(0, -1);
  return p;
}
var server = createServer((req, res) => {
  const url = req.url ?? "";
  const path = pathOf(url);
  if (req.method === "GET" && path === "/health") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
    return;
  }
  if (req.method === "GET" && path === "/v1/models") {
    handleModels(res).catch((e) => {
      if (!res.headersSent)
        sendJsonError(res, 500, e.message);
      else
        res.end();
    });
    return;
  }
  if (req.method === "POST" && path === "/v1/messages/count_tokens") {
    handleCountTokens(req, res).catch((e) => {
      if (!res.headersSent)
        sendJsonError(res, 500, e.message);
      else
        res.end();
    });
    return;
  }
  if (req.method === "POST" && path === "/v1/messages") {
    handleMessages(req, res).catch((e) => {
      process.stderr.write(`[nvidia-proxy] handler error: ${e.message}
`);
      if (!res.headersSent)
        sendJsonError(res, 500, e.message);
      else
        res.end();
    });
    return;
  }
  process.stderr.write(`[nvidia-proxy] 404 ${req.method} ${url}
`);
  sendJsonError(res, 404, `not found: ${req.method} ${url}`);
});
var startPort = Number.isFinite(REQUESTED_PORT) && REQUESTED_PORT > 0 ? REQUESTED_PORT : 0;
server.listen(startPort, "127.0.0.1", () => {
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : startPort;
  process.stdout.write(`READY ${port}
`);
});
var shutdown = () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500).unref();
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
