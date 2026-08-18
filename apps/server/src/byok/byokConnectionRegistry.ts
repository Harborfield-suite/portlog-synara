/**
 * In-process cache of last BYOK probe results + helpers to build connection views.
 */

import { byokCatalogProvider, byokProviderIndex } from "./byokCatalog.ts";
import {
  PORTLOG_OAUTH_CATALOGUE_IDS,
  resolveProviderConnection,
  resolveProviderCredential,
  type ProviderProbeResult,
} from "./providerConnection.ts";
import { testByokConnection } from "./testByokConnection.ts";

const probeCache = new Map<string, ProviderProbeResult>();

export function rememberByokProbe(providerId: string, result: ProviderProbeResult): void {
  // Network/endpoint failures are transient: retain the last definitive health
  // result so a temporary outage cannot turn a previously valid provider gray.
  if (result.kind === "network" || result.kind === "endpoint-offline") {
    return;
  }
  probeCache.set(providerId.trim(), result);
}

export function clearByokProbe(providerId: string): void {
  probeCache.delete(providerId.trim());
}

export function getRememberedByokProbe(providerId: string): ProviderProbeResult | null {
  return probeCache.get(providerId.trim()) ?? null;
}

/** Test helper */
export function resetByokProbeCacheForTests(): void {
  probeCache.clear();
}

export type ByokProviderConnectionSnapshot = {
  readonly id: string;
  readonly name: string;
  readonly doc: string;
  readonly modelCount: number;
  readonly isLocal: boolean;
  readonly wire: "openai" | "anthropic" | "gemini";
  readonly baseUrl: string;
  readonly envVar: string;
  readonly apiKeyConfigured: boolean;
  readonly status: ReturnType<typeof resolveProviderConnection>["status"];
  readonly supportedAuth: ReturnType<typeof resolveProviderConnection>["supportedAuth"];
  readonly auth: ReturnType<typeof resolveProviderConnection>["auth"];
  readonly credentialSource: ReturnType<typeof resolveProviderConnection>["credentialSource"];
  readonly maskedKeySuffix: ReturnType<typeof resolveProviderConnection>["maskedKeySuffix"];
  readonly errorReason: ReturnType<typeof resolveProviderConnection>["errorReason"];
  readonly accountLabel: string | null;
};

export function catalogueEntriesForConnectionList() {
  // byokProviderIndex already leads with the full OMP-aligned PortLog face.
  return byokProviderIndex();
}

export function envValueForProvider(providerId: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const catalogued = byokCatalogProvider(providerId);
  const envVar =
    catalogued?.env_var ||
    (providerId === "openai-codex" ? "OPENAI_API_KEY" : null) ||
    (providerId === "vercel-ai-gateway" ? "AI_GATEWAY_API_KEY" : null);
  if (!envVar) return null;
  const primary = env[envVar]?.trim();
  if (primary) return primary;
  if (providerId === "vercel-ai-gateway") {
    const vercelToken =
      env.VERCEL_OIDC_TOKEN?.trim() ||
      env.VERCEL_TOKEN?.trim() ||
      env.VERCEL_ACCESS_TOKEN?.trim();
    return vercelToken || null;
  }
  return null;
}

export function buildByokProviderConnectionSnapshot(input: {
  readonly providerId: string;
  readonly name: string;
  readonly doc: string;
  readonly modelCount: number;
  readonly isLocal: boolean;
  readonly wire: "openai" | "anthropic" | "gemini";
  readonly baseUrl: string;
  readonly envVar: string;
  readonly storedKey: string | null;
  readonly envValue: string | null;
  readonly oauthConnected?: boolean;
  readonly oauthAccountLabel?: string | null;
  readonly lastProbe?: ProviderProbeResult | null;
}): ByokProviderConnectionSnapshot {
  const credential = resolveProviderCredential({
    storedKey: input.storedKey,
    envValue: input.envValue,
  });
  const view = resolveProviderConnection({
    providerId: input.providerId,
    isLocal: input.isLocal,
    modelCount: input.modelCount,
    storedKey: input.storedKey,
    envValue: input.envValue,
    lastProbe:
      input.lastProbe === undefined
        ? getRememberedByokProbe(input.providerId)
        : input.lastProbe,
    ...(input.oauthConnected === undefined ? {} : { oauthConnected: input.oauthConnected }),
    ...(input.oauthAccountLabel === undefined ? {} : { oauthAccountLabel: input.oauthAccountLabel }),
  });
  return {
    id: input.providerId,
    name: input.name,
    doc: input.doc,
    modelCount: input.modelCount,
    isLocal: input.isLocal,
    wire: input.wire,
    baseUrl: input.baseUrl,
    envVar: input.envVar,
    apiKeyConfigured: credential !== null || Boolean(input.oauthConnected),
    status: view.status,
    supportedAuth: view.supportedAuth,
    auth: view.auth,
    credentialSource: view.credentialSource,
    maskedKeySuffix: view.maskedKeySuffix,
    errorReason: view.errorReason,
    accountLabel: input.oauthAccountLabel ?? null,
  };
}

export async function probeAndRememberByokConnection(input: {
  readonly providerId: string;
  readonly apiKey: string | null;
  readonly baseUrl?: string | null;
  readonly fetchImpl?: typeof fetch;
}): Promise<ProviderProbeResult> {
  const result = await testByokConnection(input);
  rememberByokProbe(input.providerId, result);
  return result;
}

export function isOauthCatalogueProvider(providerId: string): boolean {
  return (PORTLOG_OAUTH_CATALOGUE_IDS as readonly string[]).includes(providerId);
}
