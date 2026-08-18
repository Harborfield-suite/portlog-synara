import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

function writeTempCatalog(snapshot: object): string {
  const directory = mkdtempSync(join(tmpdir(), "byok-catalog-"));
  const filePath = join(directory, "model_catalog.json");
  writeFileSync(filePath, JSON.stringify(snapshot), "utf-8");
  return filePath;
}

function removeTempCatalog(filePath: string): void {
  rmSync(dirname(filePath), { recursive: true, force: true });
}


import {
  byokCatalogProvider,
  byokProviderIndex,
  byokProviderModels,
  loadByokCatalog,
  resetByokCatalogCacheForTests,
  resolveByokProviderId,
} from "./byokCatalog.ts";
import { CURATED_BYOK_MODEL_IDS } from "./byokToolModelCatalog.ts";
import {
  PORTLOG_EXCLUDED_OMP_PROVIDER_IDS,
  PORTLOG_OMP_PROVIDER_REGISTRY,
  isExcludedOmpProvider,
} from "./ompProviderRegistry.ts";

describe("byokCatalog (OMP models.dev parity)", () => {
  it("exposes checked-in snapshot metadata", () => {
    resetByokCatalogCacheForTests();
    expect(loadByokCatalog().metadata).toEqual({
      catalogRevision: "2026-08-13",
      ompRevision: "4dc97f89",
      syncDate: "2026-08-12",
    });
  });

  it.each([
    ["missing metadata", { featured: [], providers: {} }],
    [
      "malformed metadata",
      {
        metadata: {
          catalogRevision: "2026-08-13",
          ompRevision: "4dc97f89",
          syncDate: "not-a-date",
        },
        featured: [],
        providers: {},
      },
    ],
    [
      "impossible calendar date",
      {
        metadata: {
          catalogRevision: "2026-08-13",
          ompRevision: "4dc97f89",
          syncDate: "2026-02-31",
        },
        featured: [],
        providers: {},
      },
    ],
  ])("rejects %s", (_label, snapshot) => {
    const filePath = writeTempCatalog(snapshot);
    try {
      expect(() => loadByokCatalog(filePath)).toThrowError(/Invalid BYOK catalog metadata/);
    } finally {
      removeTempCatalog(filePath);
    }
  });

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
  it("exposes curated tool-capable models before credentials are configured", () => {
    for (const provider of ["deepseek", "mistral", "groq", "google", "vercel-ai-gateway"]) {
      const models = byokProviderModels(provider);
      expect(models.length, provider).toBeGreaterThan(0);
      expect(models.every((model) => model.toolCapable === true), provider).toBe(true);
      expect(byokCatalogProvider(provider)?.models.length, provider).toBe(models.length);
    }

    for (const [provider, ids] of Object.entries(CURATED_BYOK_MODEL_IDS)) {
      expect(byokProviderModels(provider).every((model) => ids.has(model.id)), provider).toBe(true);
    }
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
