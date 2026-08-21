import type { ByokCatalogModel, ByokCatalogProvider } from "./byokCatalog.ts";

/**
 * Product-supported model IDs that are intended for agent/tool use. This is
 * deliberately explicit: a provider catalogue can contain embeddings, image,
 * audio, moderation, and other models that PortLog cannot use as a harness.
 */
export const CURATED_BYOK_MODEL_IDS: Readonly<Record<string, ReadonlySet<string>>> = {
  deepseek: new Set([
    "deepseek-v4-pro",
    "deepseek-v4-flash",
    "deepseek-reasoner",
    "deepseek-chat",
  ]),
  mistral: new Set([
    "mistral-medium-latest",
    "mistral-medium-2604",
    "mistral-small-latest",
    "mistral-small-2603",
    "devstral-latest",
    "devstral-2512",
    "devstral-medium-latest",
    "devstral-small-2507",
    "devstral-medium-2507",
    "mistral-small-2506",
    "mistral-large-latest",
    "mistral-large-2512",
    "codestral-latest",
  ]),
  groq: new Set([
    "openai/gpt-oss-20b",
    "openai/gpt-oss-120b",
    "qwen/qwen3-32b",
    "meta-llama/llama-4-scout-17b-16e-instruct",
    "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant",
  ]),
  google: new Set([
    "gemini-3.6-flash",
    "gemini-3.5-flash-lite",
    "gemini-flash-latest",
    "gemini-3.5-flash",
    "gemini-flash-lite-latest",
    "gemini-3.1-flash-lite",
    "gemini-3.1-pro-preview-customtools",
    "gemini-3.1-pro-preview",
    "gemini-3-flash-preview",
    "gemini-3-pro-preview",
    "gemini-2.5-pro",
    "gemini-2.5-flash-lite",
    "gemini-2.5-flash",
    "gemini-2.0-flash-lite",
    "gemini-2.0-flash",
  ]),
};

/** Conservative static models for Vercel AI Gateway when its public model
 * endpoint is unavailable. IDs are gateway provider/model routes, not native
 * provider IDs. */
const VERCEL_AI_GATEWAY_STATIC_MODELS: ReadonlyArray<ByokCatalogModel> = [
  ["openai/gpt-5.5", "GPT-5.5"],
  ["openai/gpt-5.4", "GPT-5.4"],
  ["anthropic/claude-sonnet-4-6", "Claude Sonnet 4.6"],
  ["anthropic/claude-opus-4-6", "Claude Opus 4.6"],
  ["google/gemini-3.5-flash", "Gemini 3.5 Flash"],
  ["google/gemini-2.5-pro", "Gemini 2.5 Pro"],
  ["deepseek/deepseek-v4-flash", "DeepSeek V4 Flash"],
  ["xai/grok-4.3", "Grok 4.3"],
].map(([id, name]) => ({
  id,
  name,
  context: null,
  reasoning: /reason|opus|pro/i.test(id),
  released: "",
  toolCapable: true,
}));

function markToolCapable(models: ReadonlyArray<ByokCatalogModel>): ByokCatalogModel[] {
  return models.map((model) => ({ ...model, toolCapable: true }));
}

export function curatedByokProvider(providerId: string, provider: ByokCatalogProvider): ByokCatalogProvider {
  const curatedIds = CURATED_BYOK_MODEL_IDS[providerId];
  if (curatedIds) {
    return {
      ...provider,
      models: markToolCapable(provider.models.filter((model) => curatedIds.has(model.id))),
    };
  }

  if (providerId === "vercel-ai-gateway" && provider.models.length === 0) {
    return { ...provider, models: VERCEL_AI_GATEWAY_STATIC_MODELS };
  }

  return provider;
}

export function staticVercelGatewayModels(): ReadonlyArray<ByokCatalogModel> {
  return VERCEL_AI_GATEWAY_STATIC_MODELS;
}
