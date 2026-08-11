import { describe, expect, it, vi } from "vitest";

import { listByokModelsForProvider } from "./listByokModels.ts";
import {
  fetchOpenRouterModels,
  resetOpenRouterModelsCacheForTests,
} from "./openRouterModels.ts";
import {
  filterToolCapableGatewayModels,
  fetchVercelGatewayModels,
  isGatewayModelToolCapable,
  resetVercelGatewayModelsCacheForTests,
} from "./vercelGatewayModels.ts";
import {
  isByokOauthConnected,
  markByokOauthConnected,
  resetByokOauthMemoryForTests,
} from "./byokOauthMemory.ts";
import { byokCatalogProvider, loadByokCatalog, resetByokCatalogCacheForTests } from "./byokCatalog.ts";
import { supportedAuthForProvider } from "./providerConnection.ts";

describe("gateway models expansion", () => {
  it("includes vercel-ai-gateway and xai-oauth synthetic catalogue providers", () => {
    resetByokCatalogCacheForTests();
    const catalog = loadByokCatalog();
    expect(catalog.featured).toContain("vercel-ai-gateway");
    expect(byokCatalogProvider("vercel-ai-gateway")?.env_var).toBe("AI_GATEWAY_API_KEY");
    expect(byokCatalogProvider("xai-oauth")?.name).toMatch(/xAI/i);
  });

  it("merges live OpenRouter /models into listByokModels (mock HTTP)", async () => {
    resetOpenRouterModelsCacheForTests();
    const models = Array.from({ length: 45 }, (_, index) => ({
      id: `vendor/model-${index}`,
      name: `Model ${index}`,
      context_length: 128000,
      supported_parameters: ["tools", "tool_choice"],
    }));
    const fetchImpl = vi.fn(async () =>
      Response.json({ data: models }),
    ) as unknown as typeof fetch;

    const listed = await listByokModelsForProvider("openrouter", { fetchImpl, forceRefresh: true });
    expect(listed.length).toBeGreaterThan(40);
    expect(listed[0]?.toolCapable).toBe(true);
    expect(fetchImpl).toHaveBeenCalled();

    const cached = await fetchOpenRouterModels({ fetchImpl, forceRefresh: false });
    expect(cached.length).toBe(listed.length);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("falls back to vendored OpenRouter catalogue when live fetch fails", async () => {
    resetOpenRouterModelsCacheForTests();
    const fetchImpl = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    const listed = await fetchOpenRouterModels({ fetchImpl, forceRefresh: true });
    expect(listed.length).toBeGreaterThan(0);
  });

  it("Gateway discovery prefers tool-capable models and excludes embedding stubs", async () => {
    resetVercelGatewayModelsCacheForTests();
    const fetchImpl = vi.fn(async () =>
      Response.json({
        data: [
          { id: "openai/gpt-4.1", name: "GPT-4.1", type: "language" },
          { id: "openai/text-embedding-3-large", name: "Embeddings", type: "embedding" },
          {
            id: "anthropic/claude-sonnet",
            name: "Claude Sonnet",
            type: "language",
            capabilities: { tools: true },
          },
        ],
      }),
    ) as unknown as typeof fetch;

    const listed = await fetchVercelGatewayModels({ fetchImpl, forceRefresh: true });
    expect(listed.some((model) => model.id.includes("embedding"))).toBe(false);
    expect(listed.some((model) => model.id.includes("gpt-4.1"))).toBe(true);
    expect(isGatewayModelToolCapable({ id: "openai/text-embedding-3", type: "embedding" })).toBe(
      false,
    );
    expect(
      filterToolCapableGatewayModels([
        {
          id: "a",
          name: "A",
          context: null,
          reasoning: false,
          released: "",
          toolCapable: false,
        },
        {
          id: "b",
          name: "B",
          context: null,
          reasoning: false,
          released: "",
          toolCapable: true,
        },
      ]).map((model) => model.id),
    ).toEqual(["b"]);
  });

  it("marks xAI OAuth providers connected in memory", () => {
    resetByokOauthMemoryForTests();
    markByokOauthConnected("xai-oauth", "user@x.ai");
    expect(isByokOauthConnected("xai-oauth")).toBe(true);
    expect(isByokOauthConnected("xai")).toBe(true);
    expect(supportedAuthForProvider({ providerId: "xai", isLocal: false })).toEqual([
      "oauth",
      "api-key",
    ]);
    expect(supportedAuthForProvider({ providerId: "vercel-ai-gateway", isLocal: false })).toEqual([
      "api-key",
    ]);
  });
});
