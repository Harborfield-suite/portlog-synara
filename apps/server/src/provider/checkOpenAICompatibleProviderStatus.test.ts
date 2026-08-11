import { describe, expect, it } from "vitest";

import { checkOpenAICompatibleProviderStatus } from "./checkOpenAICompatibleProviderStatus.ts";

function isUsable(status: ReturnType<typeof checkOpenAICompatibleProviderStatus>): boolean {
  return status.available && status.authStatus !== "unauthenticated";
}

describe("checkOpenAICompatibleProviderStatus", () => {
  it("marks OpenRouter ready when a stored BYOK key is configured", () => {
    const status = checkOpenAICompatibleProviderStatus({
      catalogProviderId: "openrouter",
      apiKeyConfigured: true,
      checkedAt: "2026-08-07T00:00:00.000Z",
    });
    expect(status).toMatchObject({
      provider: "openaiCompatible",
      available: true,
      status: "ready",
      authStatus: "authenticated",
      authLabel: "openrouter",
    });
    expect(isUsable(status)).toBe(true);
  });

  it("accepts env credentials when no stored key is present", () => {
    const status = checkOpenAICompatibleProviderStatus({
      catalogProviderId: "openrouter",
      apiKeyConfigured: false,
      envApiKey: "sk-or-v1-test",
    });
    expect(status.authStatus).toBe("authenticated");
    expect(isUsable(status)).toBe(true);
  });

  it("blocks send with unauthenticated when no credential exists", () => {
    const status = checkOpenAICompatibleProviderStatus({
      catalogProviderId: "openrouter",
      apiKeyConfigured: false,
      envApiKey: null,
    });
    expect(status.authStatus).toBe("unauthenticated");
    expect(isUsable(status)).toBe(false);
  });
});
