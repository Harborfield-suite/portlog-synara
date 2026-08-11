/**
 * Vercel AI Gateway model discovery (public /v1/models) + tool-capable filter.
 */

import type { ByokCatalogModel } from "./byokCatalog.ts";

export const VERCEL_AI_GATEWAY_PROVIDER_ID = "vercel-ai-gateway";
export const VERCEL_AI_GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh/v1";
export const VERCEL_AI_GATEWAY_MODELS_URL = `${VERCEL_AI_GATEWAY_BASE_URL}/models`;
export const VERCEL_AI_GATEWAY_ENV_VAR = "AI_GATEWAY_API_KEY";

const DEFAULT_TTL_MS = 5 * 60_000;

export type GatewayLiveModel = ByokCatalogModel & {
  readonly toolCapable: boolean;
};

type CacheEntry = {
  readonly fetchedAt: number;
  readonly models: ReadonlyArray<GatewayLiveModel>;
};

let cache: CacheEntry | null = null;

export function resetVercelGatewayModelsCacheForTests(): void {
  cache = null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

/**
 * Prefer models that advertise tools / function calling.
 * When Gateway metadata lacks a clean flag, keep language/chat models and
 * drop known non-tool stubs (embeddings, image, TTS, etc.).
 */
export function isGatewayModelToolCapable(raw: unknown): boolean {
  const entry = asRecord(raw);
  if (!entry) return false;

  const id = typeof entry.id === "string" ? entry.id.toLowerCase() : "";
  const name = typeof entry.name === "string" ? entry.name.toLowerCase() : "";
  const modelType =
    typeof entry.type === "string"
      ? entry.type.toLowerCase()
      : typeof entry.modelType === "string"
        ? entry.modelType.toLowerCase()
        : typeof entry.model_type === "string"
          ? entry.model_type.toLowerCase()
          : "";

  if (
    /embed|image|vision-only|tts|whisper|transcri|rerank|moderation|codec|video/.test(
      `${id} ${name} ${modelType}`,
    )
  ) {
    return false;
  }

  const tags = entry.tags;
  if (Array.isArray(tags)) {
    const tagText = tags.map(String).join(" ").toLowerCase();
    if (/embed|image|tts|rerank|video/.test(tagText) && !/chat|language|text/.test(tagText)) {
      return false;
    }
    if (tags.some((tag) => /tool|function/.test(String(tag).toLowerCase()))) {
      return true;
    }
  }

  const capabilities = asRecord(entry.capabilities) ?? asRecord(entry.supportedFeatures);
  if (capabilities) {
    if (capabilities.tools === true || capabilities.functionCalling === true) return true;
    if (capabilities.tools === false && capabilities.functionCalling === false) return false;
  }

  const supported = entry.supported_parameters ?? entry.supportedParameters;
  if (Array.isArray(supported)) {
    if (supported.some((param) => /tool|function/i.test(String(param)))) return true;
  }

  // Default: language / chat models are treated as tool-capable in practice.
  if (!modelType || modelType === "language" || modelType === "chat") return true;
  return modelType === "language" || modelType === "chat";
}

function normalizeGatewayModel(raw: unknown): GatewayLiveModel | null {
  const entry = asRecord(raw);
  if (!entry) return null;
  const id = typeof entry.id === "string" ? entry.id.trim() : "";
  if (!id) return null;
  const name =
    (typeof entry.name === "string" && entry.name.trim()) ||
    (typeof entry.id === "string" ? entry.id : id);
  const context =
    typeof entry.context_window === "number"
      ? entry.context_window
      : typeof entry.contextWindow === "number"
        ? entry.contextWindow
        : typeof entry.context_length === "number"
          ? entry.context_length
          : null;
  const reasoning =
    Boolean(entry.reasoning) ||
    /reason|o1|o3|r1|thinking|opus|sonnet-4|gpt-5/i.test(`${id} ${name}`);
  return {
    id,
    name,
    context,
    reasoning,
    released: typeof entry.released === "string" ? entry.released : "",
    toolCapable: isGatewayModelToolCapable(raw),
  };
}

export function filterToolCapableGatewayModels(
  models: ReadonlyArray<GatewayLiveModel>,
): ReadonlyArray<GatewayLiveModel> {
  const withFlag = models.filter((model) => model.toolCapable);
  // If metadata never set toolCapable true, keep the full chat list rather than empty.
  return withFlag.length > 0 ? withFlag : models;
}

export async function fetchVercelGatewayModels(input?: {
  readonly fetchImpl?: typeof fetch;
  readonly ttlMs?: number;
  readonly now?: () => number;
  readonly forceRefresh?: boolean;
  readonly preferToolCapable?: boolean;
}): Promise<ReadonlyArray<GatewayLiveModel>> {
  const now = input?.now?.() ?? Date.now();
  const ttlMs = input?.ttlMs ?? DEFAULT_TTL_MS;
  if (!input?.forceRefresh && cache && now - cache.fetchedAt < ttlMs) {
    return input?.preferToolCapable === false
      ? cache.models
      : filterToolCapableGatewayModels(cache.models);
  }

  const fetchImpl = input?.fetchImpl ?? globalThis.fetch;
  try {
    const controller = new AbortController();
    const timeoutMs = 8_000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(VERCEL_AI_GATEWAY_MODELS_URL, {
        method: "GET",
        headers: { accept: "application/json" },
        signal: controller.signal,
      } as RequestInit);
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      return cache?.models ?? [];
    }
    const json = (await response.json()) as unknown;
    const data = asRecord(json)?.data;
    if (!Array.isArray(data)) {
      return cache?.models ?? [];
    }
    const models = data
      .map(normalizeGatewayModel)
      .filter((model): model is GatewayLiveModel => model !== null)
      .sort((a, b) => a.id.localeCompare(b.id));
    cache = { fetchedAt: now, models };
    return input?.preferToolCapable === false
      ? models
      : filterToolCapableGatewayModels(models);
  } catch {
    return cache?.models ?? [];
  }
}
