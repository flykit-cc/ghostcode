import { describe, expect, test } from "bun:test";
import {
  anthropicToOpenAIRequest,
  openAIToAnthropicResponse,
  StreamTranslator,
  TranslationError,
  type AnthropicRequest,
  type OpenAIResponse,
} from "./translate.ts";

describe("anthropicToOpenAIRequest", () => {
  test("plain text turn", () => {
    const req: AnthropicRequest = {
      model: "claude-test",
      max_tokens: 100,
      messages: [{ role: "user", content: "hello" }],
    };
    const out = anthropicToOpenAIRequest(req, "meta/llama-3.3-70b-instruct");
    expect(out.model).toBe("meta/llama-3.3-70b-instruct");
    expect(out.messages).toEqual([{ role: "user", content: "hello" }]);
    expect(out.max_tokens).toBe(100);
  });

  test("system prompt prepended as system message", () => {
    const req: AnthropicRequest = {
      model: "x",
      max_tokens: 50,
      system: "You are helpful.",
      messages: [{ role: "user", content: "hi" }],
    };
    const out = anthropicToOpenAIRequest(req);
    expect(out.messages[0]).toEqual({
      role: "system",
      content: "You are helpful.",
    });
    expect(out.messages[1]).toEqual({ role: "user", content: "hi" });
  });

  test("array system prompt joined", () => {
    const req: AnthropicRequest = {
      model: "x",
      max_tokens: 50,
      system: [
        { type: "text", text: "Part A." },
        { type: "text", text: "Part B." },
      ],
      messages: [{ role: "user", content: "hi" }],
    };
    const out = anthropicToOpenAIRequest(req);
    expect(out.messages[0]).toEqual({
      role: "system",
      content: "Part A.\nPart B.",
    });
  });

  test("assistant tool_use becomes tool_calls", () => {
    const req: AnthropicRequest = {
      model: "x",
      max_tokens: 50,
      messages: [
        { role: "user", content: "weather?" },
        {
          role: "assistant",
          content: [
            { type: "text", text: "Let me check." },
            {
              type: "tool_use",
              id: "toolu_1",
              name: "get_weather",
              input: { city: "NYC" },
            },
          ],
        },
      ],
    };
    const out = anthropicToOpenAIRequest(req);
    const assistant = out.messages[1] as Extract<
      (typeof out.messages)[number],
      { role: "assistant" }
    >;
    expect(assistant.role).toBe("assistant");
    expect(assistant.content).toBe("Let me check.");
    expect(assistant.tool_calls).toEqual([
      {
        id: "toolu_1",
        type: "function",
        function: { name: "get_weather", arguments: '{"city":"NYC"}' },
      },
    ]);
  });

  test("user tool_result becomes tool message", () => {
    const req: AnthropicRequest = {
      model: "x",
      max_tokens: 50,
      messages: [
        { role: "user", content: "weather?" },
        {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "toolu_1",
              name: "get_weather",
              input: {},
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_1",
              content: "72F",
            },
          ],
        },
      ],
    };
    const out = anthropicToOpenAIRequest(req);
    expect(out.messages[2]).toEqual({
      role: "tool",
      tool_call_id: "toolu_1",
      content: "72F",
    });
  });

  test("user tool_result + text emits tool then user", () => {
    const req: AnthropicRequest = {
      model: "x",
      max_tokens: 50,
      messages: [
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "t1", content: "r" },
            { type: "text", text: "more please" },
          ],
        },
      ],
    };
    const out = anthropicToOpenAIRequest(req);
    expect(out.messages.map((m) => m.role)).toEqual(["tool", "user"]);
  });

  test("tool definitions and tool_choice mapped", () => {
    const req: AnthropicRequest = {
      model: "x",
      max_tokens: 50,
      messages: [{ role: "user", content: "go" }],
      tools: [
        {
          name: "search",
          description: "Search the web",
          input_schema: { type: "object", properties: { q: { type: "string" } } },
        },
      ],
      tool_choice: { type: "tool", name: "search" },
    };
    const out = anthropicToOpenAIRequest(req);
    expect(out.tools).toEqual([
      {
        type: "function",
        function: {
          name: "search",
          description: "Search the web",
          parameters: {
            type: "object",
            properties: { q: { type: "string" } },
          },
        },
      },
    ]);
    expect(out.tool_choice).toEqual({
      type: "function",
      function: { name: "search" },
    });
  });

  test("any tool_choice maps to required", () => {
    const out = anthropicToOpenAIRequest({
      model: "x",
      max_tokens: 1,
      messages: [{ role: "user", content: "x" }],
      tool_choice: { type: "any" },
    });
    expect(out.tool_choice).toBe("required");
  });

  test("stream sets include_usage", () => {
    const out = anthropicToOpenAIRequest({
      model: "x",
      max_tokens: 1,
      messages: [{ role: "user", content: "x" }],
      stream: true,
    });
    expect(out.stream).toBe(true);
    expect(out.stream_options).toEqual({ include_usage: true });
  });

  test("rejects unsupported content block type", () => {
    expect(() =>
      anthropicToOpenAIRequest({
        model: "x",
        max_tokens: 1,
        messages: [
          {
            role: "user",
            content: [
              // @ts-expect-error testing runtime rejection of unknown block
              { type: "image", source: {} },
            ],
          },
        ],
      }),
    ).toThrow(TranslationError);
  });
});

describe("openAIToAnthropicResponse", () => {
  test("text response", () => {
    const resp: OpenAIResponse = {
      id: "chatcmpl-1",
      model: "meta/llama",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "Hello!" },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 2 },
    };
    const out = openAIToAnthropicResponse(resp, "claude-test");
    expect(out.content).toEqual([{ type: "text", text: "Hello!" }]);
    expect(out.stop_reason).toBe("end_turn");
    expect(out.usage).toEqual({ input_tokens: 10, output_tokens: 2 });
  });

  test("tool_calls response", () => {
    const resp: OpenAIResponse = {
      id: "chatcmpl-2",
      model: "x",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: {
                  name: "get_weather",
                  arguments: '{"city":"NYC"}',
                },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    };
    const out = openAIToAnthropicResponse(resp, "claude-test");
    expect(out.content).toEqual([
      {
        type: "tool_use",
        id: "call_1",
        name: "get_weather",
        input: { city: "NYC" },
      },
    ]);
    expect(out.stop_reason).toBe("tool_use");
  });
});

describe("StreamTranslator", () => {
  test("emits message_start, text deltas, then stop sequence", () => {
    const t = new StreamTranslator("claude-test");
    const all = [
      ...t.push({
        id: "1",
        choices: [{ index: 0, delta: { role: "assistant", content: "" } }],
      }),
      ...t.push({ choices: [{ index: 0, delta: { content: "Hello" } }] }),
      ...t.push({ choices: [{ index: 0, delta: { content: " world" } }] }),
      ...t.push({
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 5, completion_tokens: 2 },
      }),
    ];
    const types = all.map((e) => e.event);
    expect(types).toEqual([
      "message_start",
      "content_block_start",
      "content_block_delta",
      "content_block_delta",
      "content_block_stop",
      "message_delta",
      "message_stop",
    ]);
    const startData = all[1].data as { content_block: { type: string } };
    expect(startData.content_block.type).toBe("text");
    const deltaData = all[2].data as { delta: { text: string } };
    expect(deltaData.delta.text).toBe("Hello");
    const msgDelta = all[5].data as {
      delta: { stop_reason: string };
      usage: { output_tokens: number };
    };
    expect(msgDelta.delta.stop_reason).toBe("end_turn");
    expect(msgDelta.usage.output_tokens).toBe(2);
  });

  test("streaming tool_call across multiple chunks", () => {
    const t = new StreamTranslator("claude-test");
    const all = [
      ...t.push({ id: "x", choices: [{ index: 0, delta: { role: "assistant" } }] }),
      ...t.push({
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_a",
                  type: "function",
                  function: { name: "foo", arguments: "" },
                },
              ],
            },
          },
        ],
      }),
      ...t.push({
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                { index: 0, function: { arguments: '{"x":' } },
              ],
            },
          },
        ],
      }),
      ...t.push({
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [{ index: 0, function: { arguments: "1}" } }],
            },
          },
        ],
      }),
      ...t.push({
        choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
      }),
    ];
    const types = all.map((e) => e.event);
    expect(types).toEqual([
      "message_start",
      "content_block_start",
      "content_block_delta",
      "content_block_delta",
      "content_block_stop",
      "message_delta",
      "message_stop",
    ]);
    const blockStart = all[1].data as {
      content_block: { type: string; name: string; id: string };
    };
    expect(blockStart.content_block.type).toBe("tool_use");
    expect(blockStart.content_block.name).toBe("foo");
    expect(blockStart.content_block.id).toBe("call_a");
    const d1 = all[2].data as {
      delta: { type: string; partial_json: string };
    };
    expect(d1.delta.type).toBe("input_json_delta");
    expect(d1.delta.partial_json).toBe('{"x":');
    const md = all[5].data as { delta: { stop_reason: string } };
    expect(md.delta.stop_reason).toBe("tool_use");
  });

  test("text then tool_call switches blocks correctly", () => {
    const t = new StreamTranslator("claude-test");
    const all = [
      ...t.push({ id: "1", choices: [{ index: 0, delta: { content: "Hi." } }] }),
      ...t.push({
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "c1",
                  type: "function",
                  function: { name: "f", arguments: "{}" },
                },
              ],
            },
          },
        ],
      }),
      ...t.push({
        choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
      }),
    ];
    const types = all.map((e) => e.event);
    // Expect: message_start, text block (start, delta, stop), tool block (start, delta), message_delta, message_stop, tool_block_stop
    // Actual order should be: ms, cb_start(text,0), cb_delta(text), cb_stop(0), cb_start(tool,1), cb_delta(json), cb_stop(1), msg_delta, msg_stop
    expect(types).toEqual([
      "message_start",
      "content_block_start",
      "content_block_delta",
      "content_block_stop",
      "content_block_start",
      "content_block_delta",
      "content_block_stop",
      "message_delta",
      "message_stop",
    ]);
  });
});
