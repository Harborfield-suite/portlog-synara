import { afterEach, describe, expect, it, vi } from "vitest";

import { streamOpenAICompatibleChat } from "./openaiCompatibleClient.ts";

describe("streamOpenAICompatibleChat", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("streams assistant deltas from an OpenAI-compatible SSE response", async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n'),
        );
        controller.enqueue(
          encoder.encode('data: {"choices":[{"delta":{"content":" world"}}]}\n\n'),
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    const fetchMock = vi.fn(async () => new Response(body, { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const deltas: string[] = [];
    const full = await streamOpenAICompatibleChat(
      {
        baseUrl: "https://openrouter.ai/api/v1",
        apiKey: "test-key",
        model: "openai/gpt-4o",
        messages: [{ role: "user", content: "hi" }],
      },
      { onTextDelta: (delta) => deltas.push(delta) },
    );

    expect(full).toBe("Hello world");
    expect(deltas).toEqual(["Hello", " world"]);
    expect(fetchMock).toHaveBeenCalledOnce();
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[1].headers).toMatchObject({
      authorization: "Bearer test-key",
    });
  });
});
