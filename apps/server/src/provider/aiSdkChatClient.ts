/**
 * AI SDK streamText path for Vercel AI Gateway (and OpenRouter via OpenAI provider).
 * Emits assistant text deltas; workspace tools stay provider-native.
 */

import { createGateway } from "@ai-sdk/gateway";
import { createOpenAI } from "@ai-sdk/openai";
import { streamText } from "ai";

export type AiSdkChatMessage = {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
};

export type AiSdkStreamHandlers = {
  readonly onTextDelta: (text: string) => void;
};

export type AiSdkChatRequest = {
  readonly provider: "vercel-ai-gateway" | "openrouter" | "openai-compatible";
  readonly apiKey: string;
  readonly model: string;
  readonly messages: ReadonlyArray<AiSdkChatMessage>;
  readonly baseUrl?: string;
  readonly signal?: AbortSignal;
  /** Injectable for tests — when set, bypasses real SDK networking. */
  readonly streamTextImpl?: typeof streamText;
};

function resolveModel(request: AiSdkChatRequest) {
  if (request.provider === "vercel-ai-gateway") {
    const gateway = createGateway({ apiKey: request.apiKey });
    return gateway(request.model);
  }
  const openai = createOpenAI({
    apiKey: request.apiKey,
    baseURL:
      request.baseUrl?.replace(/\/+$/, "") ||
      (request.provider === "openrouter"
        ? "https://openrouter.ai/api/v1"
        : "https://api.openai.com/v1"),
  });
  return openai.chat(request.model);
}

/** Streams one AI SDK turn and returns the full assistant text. */
export async function streamAiSdkChat(
  request: AiSdkChatRequest,
  handlers: AiSdkStreamHandlers,
): Promise<string> {
  const run = request.streamTextImpl ?? streamText;
  const result = run({
    // Mocked streamTextImpl may ignore model; real path needs a provider model.
    model: request.streamTextImpl
      ? ("mock-model" as never)
      : resolveModel(request),
    messages: request.messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
    abortSignal: request.signal,
  });

  let fullText = "";
  for await (const part of result.fullStream) {
    if (part.type !== "text-delta") continue;
    const delta = typeof part.text === "string" ? part.text : "";
    if (!delta) continue;
    fullText += delta;
    handlers.onTextDelta(delta);
  }
  return fullText;
}

/** Whether this catalogue provider should use the AI SDK text path. */
export function usesAiSdkChatPath(catalogProviderId: string): boolean {
  return (
    catalogProviderId === "vercel-ai-gateway" ||
    catalogProviderId === "openrouter"
  );
}
