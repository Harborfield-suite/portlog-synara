/**
 * Lightweight OpenAI-compatible credential / endpoint probe for BYOK providers.
 */

import { byokCatalogProvider } from "./byokCatalog.ts";
import type { ProviderProbeResult } from "./providerConnection.ts";

export type TestByokConnectionInput = {
  readonly providerId: string;
  readonly apiKey: string | null;
  readonly baseUrl?: string | null;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
};

function modelsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return trimmed.endsWith("/v1") ? `${trimmed}/models` : `${trimmed}/v1/models`;
}

export async function testByokConnection(
  input: TestByokConnectionInput,
): Promise<ProviderProbeResult> {
  const catalogued = byokCatalogProvider(input.providerId);
  const isLocal = catalogued?.is_local === true || input.providerId === "ollama";
  const baseUrl =
    input.baseUrl?.trim() ||
    catalogued?.base_url ||
    (isLocal ? "http://127.0.0.1:11434/v1" : null);

  if (!baseUrl) {
    return { kind: "unknown" };
  }

  if (!isLocal && !(input.apiKey?.trim())) {
    return { kind: "invalid-credential" };
  }

  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  const timeoutMs = input.timeoutMs ?? 8_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers: Record<string, string> = {
      accept: "application/json",
    };
    const key = input.apiKey?.trim();
    if (key) headers.authorization = `Bearer ${key}`;

    const response = await fetchImpl(modelsUrl(baseUrl), {
      method: "GET",
      headers,
      signal: controller.signal,
    } as RequestInit);

    if (response.ok) return { kind: "ok" };

    if (response.status === 401 || response.status === 403) {
      return { kind: "invalid-credential" };
    }

    if (isLocal) return { kind: "endpoint-offline" };
    return { kind: "network" };
  } catch {
    return isLocal ? { kind: "endpoint-offline" } : { kind: "network" };
  } finally {
    clearTimeout(timer);
  }
}
