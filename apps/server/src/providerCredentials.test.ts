import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

import * as NodeServices from "@effect/platform-node/NodeServices";

import { ServerConfig } from "./config";
import { ServerSecretStoreLive } from "./auth/Layers/ServerSecretStore";
import {
  ProviderCredentials,
  ProviderCredentialsLive,
  resolveProviderServerPassword,
  type ProviderCredentialsShape,
} from "./providerCredentials";

describe("resolveProviderServerPassword", () => {
  it("reads ProviderCredentials from the Effect service context", async () => {
    const credentials: ProviderCredentialsShape = {
      getServerPassword: () => Effect.succeed("secret"),
      replaceServerPassword: () => Effect.void,
      isServerPasswordConfigured: () => Effect.succeed(true),
      getByokApiKey: () => Effect.succeed(null),
      replaceByokApiKey: () => Effect.void,
      isByokApiKeyConfigured: () => Effect.succeed(false),
      getByokCredentialHealth: () => Effect.succeed(null),
      replaceByokCredentialHealth: () => Effect.void,
      listConfiguredByokProviders: () => Effect.succeed([]),
      getOpenAICompatibleApiKey: () => Effect.succeed(null),
      replaceOpenAICompatibleApiKey: () => Effect.void,
      isOpenAICompatibleApiKeyConfigured: () => Effect.succeed(false),
    };

    const password = await Effect.runPromise(
      resolveProviderServerPassword("kilo").pipe(
        Effect.provide(Layer.succeed(ProviderCredentials, credentials)),
      ),
    );

    expect(password).toBe("secret");
  });
});

describe("ProviderCredentials BYOK multi-provider keys", () => {
  const layer = ProviderCredentialsLive.pipe(
    Layer.provide(ServerSecretStoreLive),
    Layer.provide(
      ServerConfig.layerTest(process.cwd(), {
        prefix: "synara-byok-credentials-test-",
      }),
    ),
    Layer.provide(NodeServices.layer),
  );

  it("stores API keys independently per catalogue provider id", async () => {
    await Effect.gen(function* () {
      const credentials = yield* ProviderCredentials;
      yield* credentials.replaceByokApiKey("openrouter", "sk-or-openrouter");
      yield* credentials.replaceByokApiKey("groq", "gsk-groq");

      expect(yield* credentials.getByokApiKey("openrouter")).toBe("sk-or-openrouter");
      expect(yield* credentials.getByokApiKey("groq")).toBe("gsk-groq");
      expect(yield* credentials.isByokApiKeyConfigured("openrouter")).toBe(true);
      expect(yield* credentials.isByokApiKeyConfigured("anthropic")).toBe(false);
      expect(yield* credentials.getByokCredentialHealth("openrouter")).toBeNull();
      yield* credentials.replaceByokCredentialHealth("openrouter", "ok");
      expect(yield* credentials.getByokCredentialHealth("openrouter")).toBe("ok");
      yield* credentials.replaceByokCredentialHealth("openrouter", null);
      expect(yield* credentials.getByokCredentialHealth("openrouter")).toBeNull();

      const configured = yield* credentials.listConfiguredByokProviders();
      expect(configured.toSorted()).toEqual(["groq", "openrouter"]);

      yield* credentials.replaceByokApiKey("groq", null);
      expect(yield* credentials.getByokApiKey("groq")).toBeNull();
      expect(yield* credentials.getByokApiKey("openrouter")).toBe("sk-or-openrouter");
      expect(yield* credentials.listConfiguredByokProviders()).toEqual(["openrouter"]);
    }).pipe(Effect.provide(layer), Effect.scoped, Effect.runPromise);
  });

  it("keeps the legacy openaiCompatible key as openrouter fallback", async () => {
    await Effect.gen(function* () {
      const credentials = yield* ProviderCredentials;
      yield* credentials.replaceOpenAICompatibleApiKey("sk-legacy");
      expect(yield* credentials.getByokApiKey("openrouter")).toBe("sk-legacy");
      expect(yield* credentials.isOpenAICompatibleApiKeyConfigured()).toBe(true);
    }).pipe(Effect.provide(layer), Effect.scoped, Effect.runPromise);
  });
});
