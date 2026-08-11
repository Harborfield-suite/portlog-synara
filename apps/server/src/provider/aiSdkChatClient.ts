/**
 * AI SDK streamText path for Vercel AI Gateway (and OpenRouter via OpenAI provider).
 * Emits text deltas + optional tool-call callbacks for Synara runtime events.
 */

import { createGateway } from "@ai-sdk/gateway";
import { createOpenAI } from "@ai-sdk/openai";
import { jsonSchema, stepCountIs, streamText, tool, type ToolSet } from "ai";

export type AiSdkChatMessage = {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
};

export type AiSdkToolDefinition = {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
  readonly execute?: (args: Record<string, unknown>) => Promise<unknown> | unknown;
};

export type AiSdkStreamHandlers = {
  readonly onTextDelta: (text: string) => void;
  readonly onToolCall?: (call: {
    readonly toolCallId: string;
    readonly toolName: string;
    readonly input: unknown;
  }) => void;
  readonly onToolResult?: (result: {
    readonly toolCallId: string;
    readonly toolName: string;
    readonly output: unknown;
  }) => void;
  readonly onToolError?: (error: {
    readonly toolCallId: string;
    readonly toolName: string;
    readonly error: unknown;
  }) => void;
};

export type AiSdkChatRequest = {
  readonly provider: "vercel-ai-gateway" | "openrouter" | "openai-compatible";
  readonly apiKey: string;
  readonly model: string;
  readonly messages: ReadonlyArray<AiSdkChatMessage>;
  readonly baseUrl?: string;
  readonly tools?: ReadonlyArray<AiSdkToolDefinition>;
  readonly signal?: AbortSignal;
  /** Injectable for tests — when set, bypasses real SDK networking. */
  readonly streamTextImpl?: typeof streamText;
};

function toSdkTools(defs: ReadonlyArray<AiSdkToolDefinition> | undefined): ToolSet | undefined {
  if (!defs || defs.length === 0) return undefined;
  const tools: ToolSet = {};
  for (const def of defs) {
    tools[def.name] = tool({
      description: def.description,
      inputSchema: jsonSchema(def.parameters as never),
      execute: def.execute
        ? async (input) => def.execute!(input as Record<string, unknown>)
        : async () => ({ ok: true }),
    });
  }
  return tools;
}

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

/**
 * Streams one AI SDK turn. Returns full assistant text.
 * Tool calls (when models invoke them) are surfaced via handlers.
 */
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
    tools: toSdkTools(request.tools),
    abortSignal: request.signal,
    stopWhen: request.tools?.length ? stepCountIs(5) : undefined,
  });

  let fullText = "";
  for await (const part of result.fullStream) {
    if (part.type === "text-delta") {
      const delta = typeof part.text === "string" ? part.text : "";
      if (!delta) continue;
      fullText += delta;
      handlers.onTextDelta(delta);
    } else if (part.type === "tool-call") {
      handlers.onToolCall?.({
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        input: "input" in part ? part.input : undefined,
      });
    } else if (part.type === "tool-result") {
      handlers.onToolResult?.({
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        output: "output" in part ? part.output : undefined,
      });
    } else if (part.type === "tool-error") {
      handlers.onToolError?.({
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        error: "error" in part ? part.error : undefined,
      });
    }
  }
  return fullText;
}

/** Smoke helper: build a single echo tool for adapter tests. */
export function createEchoTool(): AiSdkToolDefinition {
  return {
    name: "echo",
    description: "Echoes the provided message back.",
    parameters: { type: "object", properties: { message: { type: "string" } } },
    execute: (args) => ({ echoed: String(args.message ?? "") }),
  };
}

/** Whether this catalogue provider should use the AI SDK + tools path. */
export function usesAiSdkChatPath(catalogProviderId: string): boolean {
  return (
    catalogProviderId === "vercel-ai-gateway" ||
    catalogProviderId === "openrouter"
  );
}
