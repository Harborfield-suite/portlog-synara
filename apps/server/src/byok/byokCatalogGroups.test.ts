import { describe, expect, it } from "vitest";

import type { ByokCatalog } from "./byokCatalog.ts";
import { listByokCatalogGroups } from "./byokCatalogGroups.ts";

const catalog = {
  metadata: {
    catalogRevision: "test-revision",
    ompRevision: "test-omp-revision",
    syncDate: "2026-08-13",
  },
  featured: ["alpha", "beta"],
  providers: {
    alpha: {
      name: "Alpha Labs",
      wire: "openai",
      base_url: "https://alpha.example/v1",
      env_var: "ALPHA_API_KEY",
      doc: "https://alpha.example/docs",
      models: [
        {
          id: "alpha-reasoner",
          name: "Alpha Reasoner",
          context: 128000,
          reasoning: true,
          released: "2026-01-01",
          toolCapable: true,
        },
        {
          id: "alpha-chat",
          name: "Alpha Chat",
          context: 64000,
          reasoning: false,
          released: "2025-12-01",
        },
      ],
    },
    beta: {
      name: "Beta AI",
      wire: "anthropic",
      base_url: "https://beta.example/v1",
      env_var: "BETA_API_KEY",
      doc: "https://beta.example/docs",
      models: [
        {
          id: "beta-chat",
          name: "Beta Chat",
          context: 32000,
          reasoning: false,
          released: "2026-02-01",
          toolCapable: false,
        },
        {
          id: "beta-scout",
          name: "Scout",
          context: 16000,
          reasoning: true,
          released: "2026-03-01",
        },
      ],
    },
    zeta: {
      name: "Zeta",
      wire: "gemini",
      base_url: "https://zeta.example/v1",
      env_var: "ZETA_API_KEY",
      doc: "https://zeta.example/docs",
      models: [
        {
          id: "zeta-one",
          name: "Zeta One",
          context: 8000,
          reasoning: false,
          released: "2026-01-15",
        },
      ],
    },
    gamma: {
      name: "Gamma",
      wire: "openai",
      base_url: "https://gamma.example/v1",
      env_var: "GAMMA_API_KEY",
      doc: "https://gamma.example/docs",
      models: [
        {
          id: "gamma-one",
          name: "Gamma One",
          context: 8000,
          reasoning: false,
          released: "2026-01-16",
        },
      ],
    },
  },
} satisfies ByokCatalog;

describe("listByokCatalogGroups", () => {
  it("returns every supplied group in catalog order and preserves stored model order for an empty query", () => {
    const groups = listByokCatalogGroups({ catalog, query: "   " });

    expect(groups.map((group) => group.id)).toEqual(["alpha", "beta", "gamma", "zeta"]);
    expect(groups[0]).toMatchObject({
      id: "alpha",
      name: "Alpha Labs",
      doc: "https://alpha.example/docs",
    });
    expect(groups[0]?.models.map((model) => model.id)).toEqual([
      "alpha-reasoner",
      "alpha-chat",
    ]);
    expect(groups[0]?.models[0]).toEqual({
      id: "alpha-reasoner",
      qualifiedId: "alpha/alpha-reasoner",
      name: "Alpha Reasoner",
      context: 128000,
      reasoning: true,
      released: "2026-01-01",
      toolCapable: true,
    });
  });

  it("keeps all stored rows when the provider identity or display name matches", () => {
    const byId = listByokCatalogGroups({ catalog, query: "ALPHA" });
    const byName = listByokCatalogGroups({ catalog, query: " beta ai " });

    expect(byId).toHaveLength(1);
    expect(byId[0]?.id).toBe("alpha");
    expect(byId[0]?.models.map((model) => model.id)).toEqual([
      "alpha-reasoner",
      "alpha-chat",
    ]);
    expect(byName).toHaveLength(1);
    expect(byName[0]?.id).toBe("beta");
    expect(byName[0]?.models.map((model) => model.id)).toEqual([
      "beta-chat",
      "beta-scout",
    ]);
  });

  it("keeps only model rows that match a model id or display name", () => {
    const groups = listByokCatalogGroups({ catalog, query: "scout" });

    expect(groups).toHaveLength(1);
    expect(groups[0]?.id).toBe("beta");
    expect(groups[0]?.models).toEqual([
      {
        id: "beta-scout",
        qualifiedId: "beta/beta-scout",
        name: "Scout",
        context: 16000,
        reasoning: true,
        released: "2026-03-01",
      },
    ]);
  });

  it("matches an exact fully qualified provider/model identity", () => {
    const groups = listByokCatalogGroups({ catalog, query: "beta/beta-chat" });

    expect(groups).toHaveLength(1);
    expect(groups[0]?.id).toBe("beta");
    expect(groups[0]?.models.map((model) => model.qualifiedId)).toEqual([
      "beta/beta-chat",
    ]);
  });

  it("returns no groups for an unknown query", () => {
    expect(listByokCatalogGroups({ catalog, query: "does-not-exist" })).toEqual([]);
  });
});
