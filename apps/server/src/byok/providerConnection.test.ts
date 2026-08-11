import { describe, expect, it } from "vitest";

import {
  bucketProvidersBySection,
  maskApiKeySuffix,
  resolveProviderConnection,
  resolveProviderCredential,
  sectionForProviderConnection,
  supportedAuthForProvider,
} from "./providerConnection.ts";

describe("providerConnection", () => {
  it("prefers stored keys over environment and reports source", () => {
    expect(
      resolveProviderCredential({
        storedKey: "sk-stored",
        envValue: "sk-env",
      }),
    ).toEqual({ apiKey: "sk-stored", source: "stored" });
    expect(
      resolveProviderCredential({
        storedKey: null,
        envValue: "sk-env",
      }),
    ).toEqual({ apiKey: "sk-env", source: "environment" });
    expect(resolveProviderCredential({ storedKey: null, envValue: null })).toBeNull();
  });

  it("masks keys without revealing the full secret", () => {
    expect(maskApiKeySuffix("sk-or-abcdefghijklmnop72FQ")).toBe("••••••••••72FQ");
  });

  it("supports oauth+api-key for Anthropic and api-key for OpenRouter", () => {
    expect(supportedAuthForProvider({ providerId: "anthropic", isLocal: false })).toEqual([
      "oauth",
      "api-key",
    ]);
    expect(supportedAuthForProvider({ providerId: "openrouter", isLocal: false })).toEqual([
      "api-key",
    ]);
    expect(supportedAuthForProvider({ providerId: "ollama", isLocal: true })).toEqual(["none"]);
  });

  it("does not mark API-key providers connected until a probe succeeds", () => {
    const checking = resolveProviderConnection({
      providerId: "openrouter",
      isLocal: false,
      modelCount: 10,
      storedKey: "sk-test",
      envValue: null,
      lastProbe: null,
    });
    expect(checking.status).toBe("checking");
    expect(checking.credentialSource).toBe("stored");

    const connected = resolveProviderConnection({
      providerId: "openrouter",
      isLocal: false,
      modelCount: 10,
      storedKey: "sk-test",
      envValue: null,
      lastProbe: { kind: "ok" },
    });
    expect(connected.status).toBe("connected");
    expect(connected.auth).toBe("api-key");

    const errored = resolveProviderConnection({
      providerId: "openrouter",
      isLocal: false,
      modelCount: 10,
      storedKey: "sk-test",
      envValue: null,
      lastProbe: { kind: "invalid-credential" },
    });
    expect(errored.status).toBe("error");
    expect(errored.errorReason).toBe("invalid-credential");
  });

  it("treats oauth connected as Connected without an API key", () => {
    const view = resolveProviderConnection({
      providerId: "anthropic",
      isLocal: false,
      modelCount: 6,
      storedKey: null,
      envValue: null,
      lastProbe: null,
      oauthConnected: true,
      oauthAccountLabel: "vikram@example.com",
    });
    expect(view.status).toBe("connected");
    expect(view.auth).toBe("oauth");
  });

  it("marks Ollama endpoint-offline as unavailable, not not-configured", () => {
    const view = resolveProviderConnection({
      providerId: "ollama",
      isLocal: true,
      modelCount: 4,
      storedKey: null,
      envValue: null,
      lastProbe: { kind: "endpoint-offline" },
    });
    expect(view.status).toBe("unavailable");
    expect(sectionForProviderConnection({ isLocal: true, status: view.status })).toBe("local");
  });

  it("buckets providers into Connected / Local / Not connected", () => {
    const buckets = bucketProvidersBySection([
      { id: "openrouter", isLocal: false, status: "connected" as const },
      { id: "openrouter-bad", isLocal: false, status: "error" as const },
      { id: "ollama", isLocal: true, status: "unavailable" as const },
      { id: "groq", isLocal: false, status: "not-configured" as const },
    ]);
    expect(buckets.connected.map((entry) => entry.id)).toEqual(["openrouter", "openrouter-bad"]);
    expect(buckets.local.map((entry) => entry.id)).toEqual(["ollama"]);
    expect(buckets.notConnected.map((entry) => entry.id)).toEqual(["groq"]);
  });
});
