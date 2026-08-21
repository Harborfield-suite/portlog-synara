/**
 * Live OpenRouter model index with short TTL cache.
 * Falls back to the vendored models.dev snapshot on network failure.
 */

import type { ByokCatalogModel } from "./byokCatalog.ts";
import { byokProviderModels } from "./byokCatalog.ts";

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const DEFAULT_TTL_MS = 5 * 60_000;

export type OpenRouterLiveModel = ByokCatalogModel & {
  readonly toolCapable: boolean;
};

type CacheEntry = {
  readonly fetchedAt: number;
  readonly models: ReadonlyArray<OpenRouterLiveModel>;
};

let cache: CacheEntry | null = null;

export function resetOpenRouterModelsCacheForTests(): void {
  cache = null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function readToolCapable(entry: Record<string, unknown>): boolean {
  const supported = entry.supported_parameters ?? entry.supportedParameters;
  if (Array.isArray(supported)) {
    return supported.some(
      (param) =>
        param === "tools" ||
        param === "tool_choice" ||
        param === "functions" ||
        param === "function_call",
    );
  }
  const architecture = asRecord(entry.architecture);
  const modality = architecture?.modality;
  if (typeof modality === "string" && /text/i.test(modality)) {
    // OpenRouter often omits tools in list payload; chat+text models are tool-capable in practice.
    return true;
  }
  return true;
}

function normalizeOpenRouterModel(raw: unknown): OpenRouterLiveModel | null {
  const entry = asRecord(raw);
  if (!entry) return null;
  const id = typeof entry.id === "string" ? entry.id.trim() : "";
  if (!id) return null;
  const name =
    (typeof entry.name === "string" && entry.name.trim()) ||
    (typeof entry.id === "string" ? entry.id : id);
  const contextLength =
    typeof entry.context_length === "number"
      ? entry.context_length
      : typeof entry.contextLength === "number"
        ? entry.contextLength
        : null;
  const topProvider = asRecord(entry.top_provider);
  const reasoning =
    Boolean(entry.reasoning) ||
    Boolean(asRecord(entry.pricing)?.completion) ||
    /reason|o1|o3|r1|thinking/i.test(id);
  const released =
    (typeof entry.created === "number"
      ? new Date(entry.created * 1000).toISOString().slice(0, 10)
      : "") ||
    (typeof entry.released === "string" ? entry.released : "");
  return {
    id,
    name,
    context: contextLength ?? (typeof topProvider?.max_completion_tokens === "number"
      ? topProvider.max_completion_tokens
      : null),
    reasoning,
    released,
    toolCapable: readToolCapable(entry),
  };
}

function vendoredFallback(): ReadonlyArray<OpenRouterLiveModel> {
  return byokProviderModels("openrouter").map((model) => ({
    ...model,
    toolCapable: true,
  }));
}

export async function fetchOpenRouterModels(input?: {
  readonly fetchImpl?: typeof fetch;
  readonly ttlMs?: number;
  readonly now?: () => number;
  readonly forceRefresh?: boolean;
}): Promise<ReadonlyArray<OpenRouterLiveModel>> {
  const now = input?.now?.() ?? Date.now();
  const ttlMs = input?.ttlMs ?? DEFAULT_TTL_MS;
  if (!input?.forceRefresh && cache && now - cache.fetchedAt < ttlMs) {
    return cache.models;
  }

  const fetchImpl = input?.fetchImpl ?? globalThis.fetch;
  try {
    const controller = new AbortController();
    const timeoutMs = 8_000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(OPENROUTER_MODELS_URL, {
        method: "GET",
        headers: { accept: "application/json" },
        signal: controller.signal,
      } as RequestInit);
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      return cache?.models ?? vendoredFallback();
    }
    const json = (await response.json()) as unknown;
    const data = asRecord(json)?.data;
    if (!Array.isArray(data)) {
      return cache?.models ?? vendoredFallback();
    }
    const models = data
      .map(normalizeOpenRouterModel)
      .filter((model): model is OpenRouterLiveModel => model !== null)
      .sort((a, b) => a.id.localeCompare(b.id));
    if (models.length === 0) {
      return cache?.models ?? vendoredFallback();
    }
    cache = { fetchedAt: now, models };
    return models;
  } catch {
    return cache?.models ?? vendoredFallback();
  }
}
