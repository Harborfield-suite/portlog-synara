import { describe, expect, it } from "vitest";

import {
  byokCatalogModelSelection,
  byokCatalogSearchQuery,
  isByokProviderUsable,
  modelsForSelectedByokProvider,
} from "./ByokModelCatalogPanel";

describe("isByokProviderUsable", () => {
  it("requires a connected credential for remote providers", () => {
    expect(isByokProviderUsable({ isLocal: false, status: "not-configured" })).toBe(false);
    expect(isByokProviderUsable({ isLocal: false, status: "checking", apiKeyConfigured: false })).toBe(false);
    expect(isByokProviderUsable({ isLocal: false, status: "checking", apiKeyConfigured: true })).toBe(true);
    expect(isByokProviderUsable({ isLocal: false, status: "connected" })).toBe(true);
  });

  it("allows an available local endpoint without an API key", () => {
    expect(isByokProviderUsable({ isLocal: true, status: "checking" })).toBe(true);
    expect(isByokProviderUsable({ isLocal: true, status: "unavailable" })).toBe(false);
  });
});

describe("modelsForSelectedByokProvider", () => {
  it("does not expose a previous provider response while the new provider loads", () => {
    const models = [{ id: "provider-a/model", name: "Provider A model", context: null, reasoning: false, released: "" }];
    expect(
      modelsForSelectedByokProvider({
        selectedProviderId: "provider-b",
        responseProvider: "provider-a",
        models,
      }),
    ).toEqual([]);
  });
});

describe("BYOK catalog search and selection helpers", () => {
  it("normalizes the server search query without changing its terms", () => {
    expect(byokCatalogSearchQuery("  open router/model  ")).toBe("open router/model");
    expect(byokCatalogSearchQuery("")).toBe("");
  });

  it("displays qualified identity while persisting the provider-local model ID", () => {
    expect(
      byokCatalogModelSelection({
        providerId: "openrouter",
        model: { id: "gpt-4o", qualifiedId: "openrouter/openai/gpt-4o" },
      }),
    ).toEqual({
      openaiCompatibleCatalogProviderId: "openrouter",
      openaiCompatibleDefaultModel: "gpt-4o",
    });
  });
});
