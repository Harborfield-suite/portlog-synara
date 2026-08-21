// FILE: openaiCompatibleClient.ts
// Purpose: Host-owned OpenAI-compatible chat completions client for BYOK turns.
// Layer: Server provider runtime helper (no vendor CLI / Pi auth.json)

export type OpenAICompatibleChatMessage = {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
};

export type OpenAICompatibleChatRequest = {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly messages: ReadonlyArray<OpenAICompatibleChatMessage>;
  readonly signal?: AbortSignal;
};

export type OpenAICompatibleStreamHandlers = {
  readonly onTextDelta: (text: string) => void;
};

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/u, "");
}

function completionsUrl(baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl);
  return normalized.endsWith("/chat/completions")
    ? normalized
    : `${normalized}/chat/completions`;
}

function parseSseDataLine(line: string): unknown | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;
  const payload = trimmed.slice("data:".length).trim();
  if (!payload || payload === "[DONE]") return null;
  try {
    return JSON.parse(payload) as unknown;
  } catch {
    return null;
  }
}

function extractDeltaText(chunk: unknown): string {
  if (!chunk || typeof chunk !== "object") return "";
  const choices = (chunk as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return "";
  const first = choices[0];
  if (!first || typeof first !== "object") return "";
  const delta = (first as { delta?: unknown }).delta;
  if (!delta || typeof delta !== "object") return "";
  const content = (delta as { content?: unknown }).content;
  return typeof content === "string" ? content : "";
}

/**
 * Streams one OpenAI-compatible chat completion. Returns the full assistant text.
 * Keys are caller-supplied (host secret store); nothing is persisted here.
 */
export async function streamOpenAICompatibleChat(
  request: OpenAICompatibleChatRequest,
  handlers: OpenAICompatibleStreamHandlers,
): Promise<string> {
  const response = await globalThis.fetch(
    completionsUrl(request.baseUrl),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${request.apiKey}`,
      },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        stream: true,
      }),
      signal: request.signal,
    } as RequestInit,
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `OpenAI-compatible request failed (${response.status}): ${detail || response.statusText}`,
    );
  }

  if (!response.body) {
    throw new Error("OpenAI-compatible response had no body.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/u);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const parsed = parseSseDataLine(line);
      if (!parsed) continue;
      const delta = extractDeltaText(parsed);
      if (!delta) continue;
      fullText += delta;
      handlers.onTextDelta(delta);
    }
  }

  if (buffer.trim()) {
    const parsed = parseSseDataLine(buffer);
    if (parsed) {
      const delta = extractDeltaText(parsed);
      if (delta) {
        fullText += delta;
        handlers.onTextDelta(delta);
      }
    }
  }

  return fullText;
}
