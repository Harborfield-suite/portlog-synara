import { describe, expect, it, vi } from "vitest";

import { streamAiSdkChat } from "./aiSdkChatClient.ts";

describe("streamAiSdkChat", () => {
  it("streams text without injecting workspace tools", async () => {
    const onTextDelta = vi.fn();
    const streamTextImpl = vi.fn((options: any) => {
      expect(options).not.toHaveProperty("tools");
      expect(options).not.toHaveProperty("stopWhen");
      return {
        fullStream: (async function* () {
          yield { type: "text-delta", id: "1", text: "Hello " };
          yield { type: "text-delta", id: "1", text: "world" };
        })(),
      };
    }) as unknown as typeof import("ai").streamText;

    const text = await streamAiSdkChat(
      {
        provider: "vercel-ai-gateway",
        apiKey: "test-key",
        model: "openai/gpt-4.1",
        messages: [{ role: "user", content: "hi" }],
        streamTextImpl,
      },
      { onTextDelta },
    );

    expect(text).toBe("Hello world");
    expect(onTextDelta).toHaveBeenNthCalledWith(1, "Hello ");
    expect(onTextDelta).toHaveBeenNthCalledWith(2, "world");
  });
});
