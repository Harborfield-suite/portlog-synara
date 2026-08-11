/**
 * Provider connection view for PortLog Model Providers (OMP parity).
 * Pure resolution: credentials + last probe → status vocabulary.
 */

export type ProviderConnectionStatus =
  | "connected"
  | "not-configured"
  | "unavailable"
  | "error"
  | "checking";

export type ProviderAuthMethod = "api-key" | "oauth" | "none";

export type ProviderCredentialSource = "environment" | "stored";

export type ProviderProbeResult =
  | { readonly kind: "ok" }
  | { readonly kind: "invalid-credential" }
  | { readonly kind: "network" }
  | { readonly kind: "endpoint-offline" }
  | { readonly kind: "unknown" };

export type ResolvedProviderCredential = {
  readonly apiKey: string;
  readonly source: ProviderCredentialSource;
};

/** Catalogue / injected OAuth ids that prefer subscription login. */
export const PORTLOG_OAUTH_CATALOGUE_IDS = [
  "anthropic",
  "openai-codex",
  "xai",
  "xai-oauth",
] as const;

export function supportedAuthForProvider(input: {
  readonly providerId: string;
  readonly isLocal: boolean;
}): ProviderAuthMethod[] {
  if (input.isLocal) return ["none"];
  if (input.providerId === "vercel-ai-gateway") {
    // Gateway API key or Vercel access token / OIDC token stored as key.
    return ["api-key"];
  }
  const oauth = (PORTLOG_OAUTH_CATALOGUE_IDS as readonly string[]).includes(input.providerId);
  if (oauth) return ["oauth", "api-key"];
  return ["api-key"];
}

export function resolveProviderCredential(input: {
  readonly storedKey: string | null;
  readonly envValue: string | null | undefined;
}): ResolvedProviderCredential | null {
  const stored = input.storedKey?.trim() || null;
  if (stored) return { apiKey: stored, source: "stored" };
  const env = input.envValue?.trim() || null;
  if (env) return { apiKey: env, source: "environment" };
  return null;
}

export function maskApiKeySuffix(apiKey: string): string {
  const trimmed = apiKey.trim();
  if (trimmed.length <= 4) return "••••";
  return `••••••••••${trimmed.slice(-4)}`;
}

export type ProviderConnectionView = {
  readonly status: ProviderConnectionStatus;
  readonly auth: ProviderAuthMethod | null;
  readonly supportedAuth: readonly ProviderAuthMethod[];
  readonly credentialSource: ProviderCredentialSource | null;
  readonly maskedKeySuffix: string | null;
  readonly errorReason: "invalid-credential" | "network" | "endpoint-offline" | "unknown" | null;
  readonly modelCount: number;
};

export function resolveProviderConnection(input: {
  readonly providerId: string;
  readonly isLocal: boolean;
  readonly modelCount: number;
  readonly storedKey: string | null;
  readonly envValue: string | null | undefined;
  readonly lastProbe: ProviderProbeResult | null;
  readonly oauthConnected?: boolean;
  readonly oauthAccountLabel?: string | null;
}): ProviderConnectionView {
  const supportedAuth = supportedAuthForProvider({
    providerId: input.providerId,
    isLocal: input.isLocal,
  });

  if (input.oauthConnected) {
    return {
      status: "connected",
      auth: "oauth",
      supportedAuth,
      credentialSource: null,
      maskedKeySuffix: null,
      errorReason: null,
      modelCount: input.modelCount,
    };
  }

  if (input.isLocal) {
    if (input.lastProbe?.kind === "endpoint-offline" || input.lastProbe?.kind === "network") {
      return {
        status: "unavailable",
        auth: "none",
        supportedAuth,
        credentialSource: null,
        maskedKeySuffix: null,
        errorReason: input.lastProbe.kind === "endpoint-offline" ? "endpoint-offline" : "network",
        modelCount: input.modelCount,
      };
    }
    if (input.lastProbe?.kind === "ok" || input.lastProbe === null) {
      // Untested local defaults to connected/available once listed; callers may probe.
      return {
        status: input.lastProbe?.kind === "ok" ? "connected" : "checking",
        auth: "none",
        supportedAuth,
        credentialSource: null,
        maskedKeySuffix: null,
        errorReason: null,
        modelCount: input.modelCount,
      };
    }
  }

  const credential = resolveProviderCredential({
    storedKey: input.storedKey,
    envValue: input.envValue,
  });

  if (!credential) {
    return {
      status: "not-configured",
      auth: null,
      supportedAuth,
      credentialSource: null,
      maskedKeySuffix: null,
      errorReason: null,
      modelCount: input.modelCount,
    };
  }

  if (input.lastProbe === null) {
    return {
      status: "checking",
      auth: "api-key",
      supportedAuth,
      credentialSource: credential.source,
      maskedKeySuffix: maskApiKeySuffix(credential.apiKey),
      errorReason: null,
      modelCount: input.modelCount,
    };
  }

  if (input.lastProbe.kind === "ok") {
    return {
      status: "connected",
      auth: "api-key",
      supportedAuth,
      credentialSource: credential.source,
      maskedKeySuffix: maskApiKeySuffix(credential.apiKey),
      errorReason: null,
      modelCount: input.modelCount,
    };
  }

  const errorReason =
    input.lastProbe.kind === "invalid-credential" ||
    input.lastProbe.kind === "network" ||
    input.lastProbe.kind === "endpoint-offline" ||
    input.lastProbe.kind === "unknown"
      ? input.lastProbe.kind
      : "unknown";

  return {
    status: "error",
    auth: "api-key",
    supportedAuth,
    credentialSource: credential.source,
    maskedKeySuffix: maskApiKeySuffix(credential.apiKey),
    errorReason,
    modelCount: input.modelCount,
  };
}

export type ProviderListSection = "connected" | "local" | "not-connected";

export function sectionForProviderConnection(input: {
  readonly isLocal: boolean;
  readonly status: ProviderConnectionStatus;
}): ProviderListSection {
  if (input.isLocal) return "local";
  if (input.status === "connected" || input.status === "error" || input.status === "checking") {
    return "connected";
  }
  return "not-connected";
}

export function bucketProvidersBySection<T extends { readonly isLocal: boolean; readonly status: ProviderConnectionStatus }>(
  providers: ReadonlyArray<T>,
): {
  readonly connected: T[];
  readonly local: T[];
  readonly notConnected: T[];
} {
  const connected: T[] = [];
  const local: T[] = [];
  const notConnected: T[] = [];
  for (const provider of providers) {
    const section = sectionForProviderConnection(provider);
    if (section === "connected") connected.push(provider);
    else if (section === "local") local.push(provider);
    else notConnected.push(provider);
  }
  return { connected, local, notConnected };
}
