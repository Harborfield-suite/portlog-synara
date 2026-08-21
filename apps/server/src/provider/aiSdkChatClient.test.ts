import { describe, expect, it, vi } from "vitest";

import { streamAiSdkChat, createEchoTool } from "./aiSdkChatClient.ts";

describe("streamAiSdkChat", () => {
  it("emits tool-call runtime callbacks from a mocked AI SDK stream", async () => {
    const onTextDelta = vi.fn();
    const onToolCall = vi.fn();

    const streamTextImpl = vi.fn(() => ({
      fullStream: (async function* () {
        yield { type: "text-delta", id: "1", text: "Hello " };
        yield {
          type: "tool-call",
          toolCallId: "call_1",
          toolName: "echo",
          input: { message: "ping" },
        };
        yield { type: "text-delta", id: "1", text: "world" };
      })(),
    })) as unknown as typeof import("ai").streamText;

    const text = await streamAiSdkChat(
      {
        provider: "vercel-ai-gateway",
        apiKey: "test-key",
        model: "openai/gpt-4.1",
        messages: [{ role: "user", content: "hi" }],
        tools: [createEchoTool()],
        streamTextImpl,
      },
      { onTextDelta, onToolCall },
    );

    expect(text).toBe("Hello world");
    expect(onTextDelta).toHaveBeenCalledWith("Hello ");
    expect(onTextDelta).toHaveBeenCalledWith("world");
    expect(onToolCall).toHaveBeenCalledWith({
      toolCallId: "call_1",
      toolName: "echo",
      input: { message: "ping" },
    });
  });

  it("executes registered tools and enables multi-step continuation", async () => {
    const onToolCall = vi.fn();
    const onToolResult = vi.fn();
    const streamTextImpl = vi.fn((options: any) => ({
      fullStream: (async function* () {
        yield { type: "tool-call", toolCallId: "call_1", toolName: "echo", input: { message: "ping" } };
        const output = await options.tools.echo.execute({ message: "ping" });
        yield { type: "tool-result", toolCallId: "call_1", toolName: "echo", output };
        yield { type: "text-delta", id: "2", text: "continued" };
      })(),
    }));

    const text = await streamAiSdkChat(
      {
        provider: "openrouter",
        apiKey: "test-key",
        model: "openai/gpt-4.1",
        messages: [{ role: "user", content: "inspect" }],
        tools: [createEchoTool()],
        streamTextImpl,
      },
      { onTextDelta: vi.fn(), onToolCall, onToolResult },
    );

    expect(streamTextImpl).toHaveBeenCalledWith(expect.objectContaining({ stopWhen: expect.any(Function) }));
    expect(text).toBe("continued");
    expect(onToolCall).toHaveBeenCalledWith(expect.objectContaining({ toolName: "echo" }));
    expect(onToolResult).toHaveBeenCalledWith(expect.objectContaining({ output: { echoed: "ping" } }));
  });

});
