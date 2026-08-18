// FILE: providerCredentials.ts
// Purpose: Owns server-only credentials used to connect to external provider servers.
// Layer: Server provider security boundary

import { Effect, Layer, ServiceMap } from "effect";

import { ServerSecretStoreLive } from "./auth/Layers/ServerSecretStore";
import { ServerSecretStore, type SecretStoreError } from "./auth/Services/ServerSecretStore";

export type ExternalProviderServer = "kilo" | "opencode";

const secretName = (provider: ExternalProviderServer): string =>
  `provider-${provider}-server-password`;

/** Legacy single-key secret (pre multi-provider BYOK). Treated as openrouter. */
const LEGACY_OPENAI_COMPATIBLE_API_KEY_SECRET = "provider-openai-compatible-api-key";
const BYOK_API_KEY_PREFIX = "provider-byok-api-key:";
const BYOK_API_KEY_INDEX_SECRET = "provider-byok-api-key-index";
const BYOK_HEALTH_PREFIX = "provider-byok-health:";
const LEGACY_BYOK_PROVIDER_ID = "openrouter";

export type ByokCredentialHealth = "ok" | "invalid-credential";

function normalizeByokProviderId(providerId: string): string {
  return providerId.trim().toLowerCase();
}

function isValidByokProviderId(providerId: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{0,127}$/u.test(providerId);
}

function byokApiKeySecretName(providerId: string): string {
  return `${BYOK_API_KEY_PREFIX}${providerId}`;
}

export interface ProviderCredentialsShape {
  readonly getServerPassword: (
    provider: ExternalProviderServer,
  ) => Effect.Effect<string | null, SecretStoreError>;
  readonly replaceServerPassword: (
    provider: ExternalProviderServer,
    password: string | null,
  ) => Effect.Effect<void, SecretStoreError>;
  readonly isServerPasswordConfigured: (
    provider: ExternalProviderServer,
  ) => Effect.Effect<boolean, SecretStoreError>;
  /** Catalogue provider id (models.dev), e.g. openrouter / groq / anthropic. */
  readonly getByokApiKey: (
    providerId: string,
  ) => Effect.Effect<string | null, SecretStoreError>;
  readonly replaceByokApiKey: (
    providerId: string,
    apiKey: string | null,
  ) => Effect.Effect<void, SecretStoreError>;
  readonly isByokApiKeyConfigured: (
    providerId: string,
  ) => Effect.Effect<boolean, SecretStoreError>;
  readonly getByokCredentialHealth: (
    providerId: string,
  ) => Effect.Effect<ByokCredentialHealth | null, SecretStoreError>;
  readonly replaceByokCredentialHealth: (
    providerId: string,
    health: ByokCredentialHealth | null,
  ) => Effect.Effect<void, SecretStoreError>;
  readonly listConfiguredByokProviders: () => Effect.Effect<
    ReadonlyArray<string>,
    SecretStoreError
  >;
  /** @deprecated Prefer getByokApiKey(catalogProviderId). Reads openrouter / legacy key. */
  readonly getOpenAICompatibleApiKey: () => Effect.Effect<string | null, SecretStoreError>;
  /** @deprecated Prefer replaceByokApiKey. Writes the openrouter slot. */
  readonly replaceOpenAICompatibleApiKey: (
    apiKey: string | null,
  ) => Effect.Effect<void, SecretStoreError>;
  readonly isOpenAICompatibleApiKeyConfigured: () => Effect.Effect<boolean, SecretStoreError>;
}

export class ProviderCredentials extends ServiceMap.Service<
  ProviderCredentials,
  ProviderCredentialsShape
>()("synara/providerCredentials/ProviderCredentials") {}

export const resolveProviderServerPassword = (provider: ExternalProviderServer) =>
  Effect.gen(function* () {
    const credentials = yield* ProviderCredentials;
    return (yield* credentials.getServerPassword(provider)) ?? undefined;
  }).pipe(Effect.orDie);

export const makeProviderServerPasswordResolver =
  (credentials: ProviderCredentialsShape) =>
  (provider: ExternalProviderServer): Effect.Effect<string | undefined> =>
    credentials.getServerPassword(provider).pipe(
      Effect.map((password) => password ?? undefined),
      Effect.orDie,
    );

const makeProviderCredentials = Effect.gen(function* () {
  const secrets = yield* ServerSecretStore;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder("utf-8", { fatal: true });

  const decodeSecret = (value: Uint8Array | null): string | null => {
    if (!value || value.byteLength === 0) return null;
    const text = decoder.decode(value);
    return text.length > 0 ? text : null;
  };

  const readIndex = (): Effect.Effect<ReadonlyArray<string>, SecretStoreError> =>
    secrets.get(BYOK_API_KEY_INDEX_SECRET).pipe(
      Effect.map((value) => {
        const raw = decodeSecret(value);
        if (!raw) return [] as string[];
        try {
          const parsed = JSON.parse(raw) as unknown;
          if (!Array.isArray(parsed)) return [];
          return parsed
            .filter((entry): entry is string => typeof entry === "string")
            .map(normalizeByokProviderId)
            .filter(isValidByokProviderId);
        } catch {
          return [];
        }
      }),
    );

  const writeIndex = (providerIds: ReadonlyArray<string>): Effect.Effect<void, SecretStoreError> => {
    const unique = [...new Set(providerIds.map(normalizeByokProviderId).filter(isValidByokProviderId))].toSorted();
    return unique.length > 0
      ? secrets.set(BYOK_API_KEY_INDEX_SECRET, encoder.encode(JSON.stringify(unique)))
      : secrets.remove(BYOK_API_KEY_INDEX_SECRET);
  };

  const getServerPassword: ProviderCredentialsShape["getServerPassword"] = (provider) =>
    secrets.get(secretName(provider)).pipe(Effect.map(decodeSecret));

  const replaceServerPassword: ProviderCredentialsShape["replaceServerPassword"] = (
    provider,
    password,
  ) => {
    const normalized = password?.trim() ?? "";
    return normalized.length > 0
      ? secrets.set(secretName(provider), encoder.encode(normalized))
      : secrets.remove(secretName(provider));
  };

  const isServerPasswordConfigured: ProviderCredentialsShape["isServerPasswordConfigured"] = (
    provider,
  ) => getServerPassword(provider).pipe(Effect.map((password) => password !== null));

  const getLegacyOpenAICompatibleApiKey = () =>
    secrets.get(LEGACY_OPENAI_COMPATIBLE_API_KEY_SECRET).pipe(Effect.map(decodeSecret));

  const getByokApiKey: ProviderCredentialsShape["getByokApiKey"] = (providerId) =>
    Effect.gen(function* () {
      const normalized = normalizeByokProviderId(providerId);
      if (!isValidByokProviderId(normalized)) return null;
      const keyed = yield* secrets.get(byokApiKeySecretName(normalized)).pipe(Effect.map(decodeSecret));
      if (keyed) return keyed;
      if (normalized === LEGACY_BYOK_PROVIDER_ID) {
        return yield* getLegacyOpenAICompatibleApiKey();
      }
      return null;
    });

  const replaceByokApiKey: ProviderCredentialsShape["replaceByokApiKey"] = (providerId, apiKey) =>
    Effect.gen(function* () {
      const normalized = normalizeByokProviderId(providerId);
      if (!isValidByokProviderId(normalized)) return;
      const trimmed = apiKey?.trim() ?? "";
      const index = yield* readIndex();
      if (trimmed.length > 0) {
        yield* secrets.set(byokApiKeySecretName(normalized), encoder.encode(trimmed));
        if (normalized === LEGACY_BYOK_PROVIDER_ID) {
          yield* secrets.remove(LEGACY_OPENAI_COMPATIBLE_API_KEY_SECRET);
        }
        if (!index.includes(normalized)) {
          yield* writeIndex([...index, normalized]);
        }
        return;
      }
      yield* secrets.remove(byokApiKeySecretName(normalized));
      if (normalized === LEGACY_BYOK_PROVIDER_ID) {
        yield* secrets.remove(LEGACY_OPENAI_COMPATIBLE_API_KEY_SECRET);
      }
      yield* writeIndex(index.filter((id) => id !== normalized));
    });

  const isByokApiKeyConfigured: ProviderCredentialsShape["isByokApiKeyConfigured"] = (providerId) =>
    getByokApiKey(providerId).pipe(Effect.map((apiKey) => apiKey !== null));

  const getByokCredentialHealth: ProviderCredentialsShape["getByokCredentialHealth"] = (providerId) =>
    Effect.gen(function* () {
      const normalized = normalizeByokProviderId(providerId);
      if (!isValidByokProviderId(normalized)) return null;
      const value = yield* secrets.get(`${BYOK_HEALTH_PREFIX}${normalized}`).pipe(Effect.map(decodeSecret));
      return value === "ok" || value === "invalid-credential" ? value : null;
    });

  const replaceByokCredentialHealth: ProviderCredentialsShape["replaceByokCredentialHealth"] = (
    providerId,
    health,
  ) => {
    const normalized = normalizeByokProviderId(providerId);
    if (!isValidByokProviderId(normalized)) return Effect.void;
    return health === null
      ? secrets.remove(`${BYOK_HEALTH_PREFIX}${normalized}`)
      : secrets.set(`${BYOK_HEALTH_PREFIX}${normalized}`, encoder.encode(health));
  };

  const listConfiguredByokProviders: ProviderCredentialsShape["listConfiguredByokProviders"] = () =>
    Effect.gen(function* () {
      const indexed = yield* readIndex();
      const legacy = yield* getLegacyOpenAICompatibleApiKey();
      if (legacy && !indexed.includes(LEGACY_BYOK_PROVIDER_ID)) {
        return [...indexed, LEGACY_BYOK_PROVIDER_ID].toSorted();
      }
      return indexed;
    });

  const getOpenAICompatibleApiKey: ProviderCredentialsShape["getOpenAICompatibleApiKey"] = () =>
    getByokApiKey(LEGACY_BYOK_PROVIDER_ID);

  const replaceOpenAICompatibleApiKey: ProviderCredentialsShape["replaceOpenAICompatibleApiKey"] = (
    apiKey,
  ) => replaceByokApiKey(LEGACY_BYOK_PROVIDER_ID, apiKey);

  const isOpenAICompatibleApiKeyConfigured: ProviderCredentialsShape["isOpenAICompatibleApiKeyConfigured"] =
    () =>
      listConfiguredByokProviders().pipe(Effect.map((providers) => providers.length > 0));

  return {
    getServerPassword,
    replaceServerPassword,
    isServerPasswordConfigured,
    getByokApiKey,
    replaceByokApiKey,
    isByokApiKeyConfigured,
    getByokCredentialHealth,
    replaceByokCredentialHealth,
    listConfiguredByokProviders,
    getOpenAICompatibleApiKey,
    replaceOpenAICompatibleApiKey,
    isOpenAICompatibleApiKeyConfigured,
  } satisfies ProviderCredentialsShape;
});

export const ProviderCredentialsLive = Layer.effect(
  ProviderCredentials,
  makeProviderCredentials,
).pipe(Layer.provide(ServerSecretStoreLive));
