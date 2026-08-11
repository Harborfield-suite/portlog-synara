import { describe, expect, it } from "vitest";

import {
  byokCatalogProvider,
  byokProviderIndex,
  byokProviderModels,
  loadByokCatalog,
  resetByokCatalogCacheForTests,
  resolveByokProviderId,
} from "./byokCatalog.ts";
import {
  PORTLOG_EXCLUDED_OMP_PROVIDER_IDS,
  PORTLOG_OMP_PROVIDER_REGISTRY,
  isExcludedOmpProvider,
} from "./ompProviderRegistry.ts";

describe("byokCatalog (OMP models.dev parity)", () => {
  it("leads with the Oh My Pi registry order on the PortLog face", () => {
    resetByokCatalogCacheForTests();
    const catalog = loadByokCatalog();
    expect(catalog.featured[0]).toBe("azure");
    expect(catalog.featured).toContain("vercel-ai-gateway");
    expect(catalog.featured).toContain("openrouter");
    expect(catalog.featured).toContain("xai-oauth");
    expect(Object.keys(catalog.providers).length).toBeGreaterThan(100);

    const index = byokProviderIndex();
    expect(index[0]?.id).toBe("azure");
    expect(index.some((entry) => entry.id === "vercel-ai-gateway")).toBe(true);
    expect(index.some((entry) => entry.id === "ollama" && entry.isLocal)).toBe(true);
    expect(index.some((entry) => entry.id === "cursor")).toBe(false);
  });

  it("resolves aliases and returns OpenRouter / Moonshot models", () => {
    expect(resolveByokProviderId("gemini")).toBe("google");
    expect(resolveByokProviderId("moonshot")).toBe("moonshotai");
    const openrouter = byokCatalogProvider("openrouter");
    expect(openrouter?.wire).toBe("openai");
    expect(openrouter?.base_url).toContain("openrouter.ai");
    expect(byokProviderModels("openrouter").length).toBeGreaterThan(0);
    expect(byokProviderModels("moonshot").length).toBeGreaterThan(0);
  });
});

describe("ompProviderRegistry", () => {
  it("excludes coding-agent commodity providers from the PortLog face", () => {
    expect(isExcludedOmpProvider("cursor")).toBe(true);
    expect(PORTLOG_EXCLUDED_OMP_PROVIDER_IDS).toContain("opencode-zen");
    expect(PORTLOG_OMP_PROVIDER_REGISTRY.some((entry) => entry.id === "cursor")).toBe(false);
    expect(PORTLOG_OMP_PROVIDER_REGISTRY.some((entry) => entry.id === "openrouter")).toBe(true);
    expect(PORTLOG_OMP_PROVIDER_REGISTRY.length).toBeGreaterThan(50);
  });
});
