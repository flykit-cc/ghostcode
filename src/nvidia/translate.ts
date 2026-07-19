// Translates between Anthropic Messages API and OpenAI Chat Completions API.
// Pure functions only — no I/O — so this module is fully unit-testable.
//
// Scope (v1): text, system prompt, tools (definitions + tool_use/tool_result),
// streaming, stop reasons, token usage. Image content blocks and extended
// thinking blocks are rejected with a 400 at the proxy boundary.

export type AnthropicTextBlock = { type: "text"; text: string };
export type AnthropicToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
};
export type AnthropicToolResultBlock = {
  type: "tool_result";
  tool_use_id: string;
  content: string | Array<{ type: "text"; text: string }>;
  is_error?: boolean;
};
export type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock;

export type AnthropicMessage = {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
};

export type AnthropicTool = {
  name: string;
  description?: string;
  input_schema: unknown;
};

export type AnthropicRequest = {
  model: string;
  messages: AnthropicMessage[];
  system?: string | Array<{ type: "text"; text: string }>;
  tools?: AnthropicTool[];
  tool_choice?:
    | { type: "auto" | "any" | "none" }
    | { type: "tool"; name: string };
  max_tokens: number;
  temperature?: number;
  top_p?: number;
  stop_sequences?: string[];
  stream?: boolean;
};

export type OpenAIToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type OpenAIMessage =
  | { role: "system" | "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: OpenAIToolCall[];
    }
  | { role: "tool"; tool_call_id: string; content: string };

export type OpenAITool = {
  type: "function";
  function: { name: string; description?: string; parameters: unknown };
};

export type OpenAIRequest = {
  model: string;
  messages: OpenAIMessage[];
  tools?: OpenAITool[];
  tool_choice?:
    | "auto"
    | "none"
    | "required"
    | { type: "function"; function: { name: string } };
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop?: string[];
  stream?: boolean;
  stream_options?: { include_usage: boolean };
};

export type OpenAIChoice = {
  index: number;
  message: {
    role: "assistant";
    content: string | null;
    tool_calls?: OpenAIToolCall[];
  };
  finish_reason: "stop" | "length" | "tool_calls" | "content_filter" | null;
};

export type OpenAIResponse = {
  id: string;
  model: string;
  choices: OpenAIChoice[];
  usage?: { prompt_tokens: number; completion_tokens: number };
};

export type AnthropicResponse = {
  id: string;
  type: "message";
  role: "assistant";
  model: string;
  content: Array<AnthropicTextBlock | AnthropicToolUseBlock>;
  stop_reason: "end_turn" | "max_tokens" | "stop_sequence" | "tool_use" | null;
  stop_sequence: string | null;
  usage: { input_tokens: number; output_tokens: number };
};

export class TranslationError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function systemToString(
  sys: AnthropicRequest["system"] | undefined,
): string | null {
  if (!sys) return null;
  if (typeof sys === "string") return sys;
  return sys.map((b) => b.text).join("\n");
}

function toolResultContentToString(
  c: AnthropicToolResultBlock["content"],
): string {
  if (typeof c === "string") return c;
  return c
    .filter((b) => b && b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("");
}

function rejectUnsupportedBlock(block: { type: string }): never {
  throw new TranslationError(
    `Content block type "${block.type}" is not supported by the NVIDIA proxy. ` +
      `Supported: text, tool_use, tool_result.`,
  );
}

export function anthropicToOpenAIRequest(
  req: AnthropicRequest,
  modelOverride?: string,
): OpenAIRequest {
  const out: OpenAIMessage[] = [];

  const sys = systemToString(req.system);
  if (sys && sys.length > 0) out.push({ role: "system", content: sys });

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
      const toolCalls: OpenAIToolCall[] = [];
      for (const block of msg.content) {
        if (block.type === "text") {
          text += block.text;
        } else if (block.type === "tool_use") {
          toolCalls.push({
            id: block.id,
            type: "function",
            function: {
              name: block.name,
              arguments: JSON.stringify(block.input ?? {}),
            },
          });
        } else if (block.type === "tool_result") {
          // Tool results in an assistant message are nonsensical in Anthropic
          // but we'll be permissive and ignore.
          continue;
        } else {
          rejectUnsupportedBlock(block);
        }
      }
      const assistantMsg: OpenAIMessage = {
        role: "assistant",
        content: text.length > 0 ? text : null,
      };
      if (toolCalls.length > 0) {
        (assistantMsg as { tool_calls?: OpenAIToolCall[] }).tool_calls =
          toolCalls;
      }
      out.push(assistantMsg);
      continue;
    }

    // role === 'user': may contain text + tool_results. tool_results become
    // standalone {role:'tool'} messages; text blocks merge into a single
    // user message that follows them (or precedes if no tool_results).
    const textParts: string[] = [];
    const toolMessages: OpenAIMessage[] = [];
    for (const block of msg.content) {
      if (block.type === "text") {
        textParts.push(block.text);
      } else if (block.type === "tool_result") {
        toolMessages.push({
          role: "tool",
          tool_call_id: block.tool_use_id,
          content: toolResultContentToString(block.content),
        });
      } else if (block.type === "tool_use") {
        // Skip — tool_use in user messages is invalid in Anthropic spec.
        continue;
      } else {
        rejectUnsupportedBlock(block);
      }
    }
    // OpenAI requires tool messages to immediately follow the assistant
    // message that called them. They come first; any user text follows.
    out.push(...toolMessages);
    if (textParts.length > 0) {
      out.push({ role: "user", content: textParts.join("") });
    }
  }

  const openai: OpenAIRequest = {
    model: modelOverride ?? req.model,
    messages: out,
  };
  if (req.max_tokens !== undefined) openai.max_tokens = req.max_tokens;
  if (req.temperature !== undefined) openai.temperature = req.temperature;
  if (req.top_p !== undefined) openai.top_p = req.top_p;
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
        parameters: t.input_schema,
      },
    }));
  }

  if (req.tool_choice) {
    if (req.tool_choice.type === "auto") openai.tool_choice = "auto";
    else if (req.tool_choice.type === "none") openai.tool_choice = "none";
    else if (req.tool_choice.type === "any") openai.tool_choice = "required";
    else if (req.tool_choice.type === "tool") {
      openai.tool_choice = {
        type: "function",
        function: { name: req.tool_choice.name },
      };
    }
  }

  return openai;
}

function mapFinishReason(
  r: OpenAIChoice["finish_reason"],
): AnthropicResponse["stop_reason"] {
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

export function openAIToAnthropicResponse(
  resp: OpenAIResponse,
  anthropicModel: string,
): AnthropicResponse {
  const choice = resp.choices[0];
  if (!choice) {
    throw new TranslationError("Upstream returned no choices", 502);
  }
  const content: Array<AnthropicTextBlock | AnthropicToolUseBlock> = [];
  if (choice.message.content && choice.message.content.length > 0) {
    content.push({ type: "text", text: choice.message.content });
  }
  if (choice.message.tool_calls) {
    for (const tc of choice.message.tool_calls) {
      let input: unknown = {};
      try {
        input = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
      } catch {
        // Some models emit malformed JSON. Pass through as a string-valued
        // object so the client at least sees something.
        input = { _raw: tc.function.arguments };
      }
      content.push({
        type: "tool_use",
        id: tc.id,
        name: tc.function.name,
        input,
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
      output_tokens: resp.usage?.completion_tokens ?? 0,
    },
  };
}

// --- Streaming translator ---
//
// OpenAI emits incremental delta chunks with text in delta.content and tool
// calls in delta.tool_calls (each indexed). We turn those into the Anthropic
// event sequence: message_start → (content_block_start → deltas → stop)+ →
// message_delta → message_stop.
//
// State is kept inside the translator instance because OpenAI chunks don't
// carry enough info on their own (no "this is block N" — we have to track).

type AnthropicSseEvent = { event: string; data: unknown };

export class StreamTranslator {
  private model: string;
  private messageStarted = false;
  // Anthropic block index of the currently-open block, or -1 if none.
  private currentBlockIndex = -1;
  // Whether the current open block is text or tool_use.
  private currentBlockKind: "text" | "tool_use" | null = null;
  // OpenAI tool_call.index → Anthropic block index.
  private toolIndexMap = new Map<number, number>();
  private nextBlockIndex = 0;
  private finished = false;
  private usage: { input_tokens: number; output_tokens: number } = {
    input_tokens: 0,
    output_tokens: 0,
  };
  private upstreamId = "";

  constructor(anthropicModel: string) {
    this.model = anthropicModel;
  }

  // Feed one parsed OpenAI SSE chunk (the JSON object after `data: `).
  // Returns Anthropic SSE events to forward downstream.
  push(chunk: {
    id?: string;
    choices?: Array<{
      index?: number;
      delta?: {
        role?: string;
        content?: string | null;
        tool_calls?: Array<{
          index: number;
          id?: string;
          type?: "function";
          function?: { name?: string; arguments?: string };
        }>;
      };
      finish_reason?: string | null;
    }>;
    usage?: { prompt_tokens: number; completion_tokens: number };
  }): AnthropicSseEvent[] {
    const events: AnthropicSseEvent[] = [];

    if (chunk.id && !this.upstreamId) this.upstreamId = chunk.id;

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
            usage: { input_tokens: 0, output_tokens: 0 },
          },
        },
      });
    }

    if (chunk.usage) {
      this.usage = {
        input_tokens: chunk.usage.prompt_tokens,
        output_tokens: chunk.usage.completion_tokens,
      };
    }

    const choice = chunk.choices?.[0];
    if (!choice) return events;
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
            content_block: { type: "text", text: "" },
          },
        });
      }
      events.push({
        event: "content_block_delta",
        data: {
          type: "content_block_delta",
          index: this.currentBlockIndex,
          delta: { type: "text_delta", text: delta.content },
        },
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
                input: {},
              },
            },
          });
          // If the same chunk also includes initial arguments, emit a delta.
          if (tc.function?.arguments && tc.function.arguments.length > 0) {
            events.push({
              event: "content_block_delta",
              data: {
                type: "content_block_delta",
                index: this.currentBlockIndex,
                delta: {
                  type: "input_json_delta",
                  partial_json: tc.function.arguments,
                },
              },
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
                  partial_json: tc.function.arguments,
                },
              },
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
            stop_reason: mapFinishReason(
              choice.finish_reason as OpenAIChoice["finish_reason"],
            ),
            stop_sequence: null,
          },
          usage: { output_tokens: this.usage.output_tokens },
        },
      });
      events.push({ event: "message_stop", data: { type: "message_stop" } });
    }

    return events;
  }

  private closeCurrentBlock(): AnthropicSseEvent {
    const idx = this.currentBlockIndex;
    this.currentBlockKind = null;
    this.currentBlockIndex = -1;
    return {
      event: "content_block_stop",
      data: { type: "content_block_stop", index: idx },
    };
  }
}

export function serializeSseEvent(e: AnthropicSseEvent): string {
  return `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`;
}
