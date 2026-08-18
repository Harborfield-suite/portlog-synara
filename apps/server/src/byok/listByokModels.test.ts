import * as NodeServices from "@effect/platform-node/NodeServices";
import { ThreadId } from "@synara/contracts";
import { Effect, Layer } from "effect";
import { describe, expect, it, vi } from "vitest";

import { ServerConfig } from "../config.ts";
import {
  ProviderCredentials,
  type ProviderCredentialsShape,
} from "../providerCredentials.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { makeOpenAICompatibleAdapterLive } from "../provider/Layers/OpenAICompatibleAdapter.ts";
import { OpenAICompatibleAdapter } from "../provider/Services/OpenAICompatibleAdapter.ts";
import {
  buildByokProviderConnectionSnapshot,
  resetByokProbeCacheForTests,
} from "./byokConnectionRegistry.ts";
import {
  byokCatalogProvider,
  byokProviderIndex,
  resetByokCatalogCacheForTests,
} from "./byokCatalog.ts";
import { listByokModelsForProvider } from "./listByokModels.ts";
import { resetVercelGatewayModelsCacheForTests } from "./vercelGatewayModels.ts";

const CURATED_PROVIDER_IDS = [
  "deepseek",
  "mistral",
  "groq",
  "google",
  "vercel-ai-gateway",
] as const;

const noCredentials: ProviderCredentialsShape = {
  getServerPassword: () => Effect.succeed(null),
  replaceServerPassword: () => Effect.void,
  isServerPasswordConfigured: () => Effect.succeed(false),
  getByokApiKey: () => Effect.succeed(null),
  replaceByokApiKey: () => Effect.void,
  isByokApiKeyConfigured: () => Effect.succeed(false),
  listConfiguredByokProviders: () => Effect.succeed([]),
  getOpenAICompatibleApiKey: () => Effect.succeed(null),
  replaceOpenAICompatibleApiKey: () => Effect.void,
  isOpenAICompatibleApiKeyConfigured: () => Effect.succeed(false),
};

describe("curated BYOK provider catalog", () => {
  it("lists known tool-capable models offline while providers remain unconfigured", async () => {
    resetByokCatalogCacheForTests();
    resetVercelGatewayModelsCacheForTests();
    resetByokProbeCacheForTests();
    const offlineFetch = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;

    const lists = await Promise.all(
      CURATED_PROVIDER_IDS.map((providerId) =>
        listByokModelsForProvider(providerId, {
          fetchImpl: offlineFetch,
          forceRefresh: true,
        }),
      ),
    );

    for (const [index, providerId] of CURATED_PROVIDER_IDS.entries()) {
      const models = lists[index]!;
      const catalogued = byokCatalogProvider(providerId);
      const indexEntry = byokProviderIndex().find((entry) => entry.id === providerId);
      expect(models.length).toBeGreaterThan(0);
      expect(models.every((model) => model.toolCapable === true)).toBe(true);
      expect(catalogued?.models).toHaveLength(models.length);
      expect(indexEntry?.modelCount).toBe(models.length);
    }
    expect(offlineFetch).not.toHaveBeenCalled();

    const groq = byokCatalogProvider("groq")!;
    const unconfigured = buildByokProviderConnectionSnapshot({
      providerId: "groq",
      name: groq.name,
      doc: groq.doc,
      modelCount: groq.models.length,
      isLocal: false,
      wire: groq.wire,
      baseUrl: groq.base_url,
      envVar: groq.env_var,
      storedKey: null,
      envValue: null,
    });
    expect(unconfigured).toMatchObject({
      apiKeyConfigured: false,
      status: "not-configured",
    });
  });

  it("keeps the OpenAI-compatible runtime credential gate closed for a curated provider", async () => {
    const originalGroqKey = process.env.GROQ_API_KEY;
    delete process.env.GROQ_API_KEY;
    try {
      const prerequisites = Layer.mergeAll(
        ServerConfig.layerTest(process.cwd(), { prefix: "byok-curated-catalog-" }),
        ServerSettingsService.layerTest({
          providers: {
            openaiCompatible: {
              catalogProviderId: "groq",
              baseUrl: "",
              defaultModel: "",
              customModels: [],
              apiKeyConfigured: false,
            },
          },
        }),
        Layer.succeed(ProviderCredentials, noCredentials),
      ).pipe(Layer.provideMerge(NodeServices.layer));
      const adapterLayer = makeOpenAICompatibleAdapterLive().pipe(
        Layer.provide(prerequisites),
      );
      const result = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const adapter = yield* OpenAICompatibleAdapter;
            return yield* adapter
              .startSession({
                provider: "openaiCompatible",
                threadId: ThreadId.makeUnsafe("byok-curated-groq-without-key"),
                runtimeMode: "full-access",
              })
              .pipe(Effect.result);
          }).pipe(Effect.provide(adapterLayer)),
        ),
      );

      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") {
        expect(result.failure).toMatchObject({
          provider: "openaiCompatible",
          method: "credentials",
          detail: expect.stringContaining("groq"),
        });
      }
    } finally {
      if (originalGroqKey === undefined) {
        delete process.env.GROQ_API_KEY;
      } else {
        process.env.GROQ_API_KEY = originalGroqKey;
      }
    }
  });
});
