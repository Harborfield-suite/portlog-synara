import type { ServerProviderStatus } from "@synara/contracts";

/**
 * BYOK / OpenAI-compatible provider health — no local CLI to probe.
 * Ready when a stored or env credential exists for the active catalogue id.
 */
export function checkOpenAICompatibleProviderStatus(input: {
  readonly catalogProviderId?: string | null;
  readonly apiKeyConfigured?: boolean;
  readonly envApiKey?: string | null;
  readonly checkedAt?: string;
}): ServerProviderStatus {
  const catalogProviderId = input.catalogProviderId?.trim() || "openrouter";
  const hasKey =
    Boolean(input.apiKeyConfigured) || Boolean(input.envApiKey?.trim());
  const checkedAt = input.checkedAt ?? new Date().toISOString();

  if (!hasKey) {
    return {
      provider: "openaiCompatible",
      available: true,
      status: "error",
      authStatus: "unauthenticated",
      authType: "api-key",
      checkedAt,
      message:
        "BYOK API key is not configured. Connect a provider from the model picker.",
    };
  }

  return {
    provider: "openaiCompatible",
    available: true,
    status: "ready",
    authStatus: "authenticated",
    authType: "api-key",
    authLabel: catalogProviderId,
    checkedAt,
    message: `BYOK connected (${catalogProviderId}).`,
  };
}
