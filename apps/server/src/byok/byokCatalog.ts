// FILE: byokCatalog.ts
// Purpose: OMP-aligned models.dev catalogue loader for host-owned BYOK.
// Primary ordering comes from ompProviderRegistry (Oh My Pi registry order).

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  PORTLOG_OMP_PROVIDER_REGISTRY,
  portlogSupportedProviderIds,
  portlogOmpCatalogId,
  type PortLogOmpProviderDef,
} from "./ompProviderRegistry.ts";
import { curatedByokProvider } from "./byokToolModelCatalog.ts";

export type ByokCatalogWire = "openai" | "anthropic" | "gemini";

export type ByokCatalogModel = {
  readonly id: string;
  readonly name: string;
  readonly context: number | null;
  readonly reasoning: boolean;
  readonly released: string;
  readonly toolCapable?: boolean;
};

export type ByokCatalogProvider = {
  readonly name: string;
  readonly wire: ByokCatalogWire;
  readonly base_url: string;
  readonly env_var: string;
  readonly doc: string;
  readonly models: ReadonlyArray<ByokCatalogModel>;
  readonly is_local?: boolean;
};

export type ByokCatalogMetadata = {
  readonly catalogRevision: string;
  readonly ompRevision: string;
  readonly syncDate: string;
};

export type ByokCatalog = {
  readonly metadata: ByokCatalogMetadata;
  readonly featured: ReadonlyArray<string>;
  readonly providers: Readonly<Record<string, ByokCatalogProvider>>;
};

export type ByokProviderIndexEntry = {
  readonly id: string;
  readonly name: string;
  readonly doc: string;
  readonly modelCount: number;
  readonly isLocal: boolean;
  readonly wire: ByokCatalogWire;
  readonly baseUrl: string;
};

const PROVIDER_ALIASES: Record<string, string> = { gemini: "google" };

function syntheticFromOmp(def: PortLogOmpProviderDef): ByokCatalogProvider {
  return {
    name: def.name,
    wire: def.wire ?? "openai",
    base_url: def.baseUrl ?? "",
    env_var: def.envVar ?? "",
    doc: def.doc ?? "",
    models: [],
    ...(def.isLocal ? { is_local: true } : {}),
  };
}

function buildOmpSynthetics(
  rawProviders: Record<string, ByokCatalogProvider>,
): Record<string, ByokCatalogProvider> {
  const out: Record<string, ByokCatalogProvider> = {};
  for (const def of PORTLOG_OMP_PROVIDER_REGISTRY) {
    const catalogId = portlogOmpCatalogId(def);
    const catalogued = rawProviders[catalogId] ?? rawProviders[def.id];
    if (catalogued && def.id === catalogId) continue;
    if (catalogued && def.id !== catalogId) {
      // Alias row: keep OMP id as the PortLog connection key, reuse catalogue models/meta.
      out[def.id] = {
        ...catalogued,
        name: def.name || catalogued.name,
        ...(def.wire ? { wire: def.wire } : {}),
        ...(def.baseUrl ? { base_url: def.baseUrl } : {}),
        ...(def.envVar ? { env_var: def.envVar } : {}),
        ...(def.doc ? { doc: def.doc } : {}),
        ...(def.isLocal ? { is_local: true } : {}),
      };
      continue;
    }
    if (!catalogued) {
      out[def.id] = syntheticFromOmp(def);
    }
  }
  return out;
}

let cached: ByokCatalog | null = null;

function catalogPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "..", "..", "data", "model_catalog.json");
}

function parseCatalogMetadata(value: unknown): ByokCatalogMetadata {
  if (typeof value !== "object" || value === null) {
    throw new Error(
      "Invalid BYOK catalog metadata: expected catalogRevision, ompRevision, and syncDate strings.",
    );
  }
  const metadata = value as Record<string, unknown>;
  if (
    typeof metadata.catalogRevision !== "string" ||
    metadata.catalogRevision.trim() === "" ||
    typeof metadata.ompRevision !== "string" ||
    metadata.ompRevision.trim() === "" ||
    typeof metadata.syncDate !== "string" ||
    metadata.syncDate.trim() === ""
  ) {
    throw new Error(
      "Invalid BYOK catalog metadata: expected catalogRevision, ompRevision, and syncDate strings.",
    );
  }
  const parsedSyncDate = new Date(`${metadata.syncDate}T00:00:00.000Z`);
  const [year, month, day] = metadata.syncDate.split("-").map(Number);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(metadata.syncDate) ||
    Number.isNaN(parsedSyncDate.getTime()) ||
    parsedSyncDate.getUTCFullYear() !== year ||
    parsedSyncDate.getUTCMonth() !== month - 1 ||
    parsedSyncDate.getUTCDate() !== day
  ) {
    throw new Error(
      "Invalid BYOK catalog metadata: syncDate must be an ISO date (YYYY-MM-DD).",
    );
  }
  return {
    catalogRevision: metadata.catalogRevision,
    ompRevision: metadata.ompRevision,
    syncDate: metadata.syncDate,
  };
}

export function loadByokCatalog(catalogFilePath = catalogPath()): ByokCatalog {
  if (cached && catalogFilePath === catalogPath()) return cached;
  const raw = JSON.parse(readFileSync(catalogFilePath, "utf-8")) as {
    metadata: unknown;
    featured: string[];
    providers: Record<string, ByokCatalogProvider>;
  };
  const metadata = parseCatalogMetadata(raw.metadata);
  const ompSynthetics = buildOmpSynthetics(raw.providers);
  const mergedProviders = Object.fromEntries(
    Object.entries({
      ...raw.providers,
      ...ompSynthetics,
    }).map(([id, provider]) => [id, curatedByokProvider(id, provider)]),
  ) as Record<string, ByokCatalogProvider>;
  // OMP registry order is the PortLog face; models.dev featured fills any gaps.
  const supportedProviderIds = new Set(portlogSupportedProviderIds());
  const ompIds = portlogSupportedProviderIds().filter((id) => mergedProviders[id]);
  const ompSet = new Set(ompIds);
  const featured = [
    ...ompIds,
    ...raw.featured.filter(
      (id) => supportedProviderIds.has(id) && mergedProviders[id] && !ompSet.has(id),
    ),
  ];
  const catalog: ByokCatalog = {
    metadata,
    featured,
    providers: mergedProviders,
  };
  if (catalogFilePath === catalogPath()) cached = catalog;
  return catalog;
}

/** Test helper — clears the module cache between cases. */
export function resetByokCatalogCacheForTests(): void {
  cached = null;
}

export function resolveByokProviderId(provider: string): string {
  const trimmed = provider.trim();
  if (PROVIDER_ALIASES[trimmed]) return PROVIDER_ALIASES[trimmed]!;
  const omp = PORTLOG_OMP_PROVIDER_REGISTRY.find((entry) => entry.id === trimmed);
  if (omp?.catalogId) return omp.catalogId;
  return trimmed;
}

export function byokCatalogProvider(provider: string): ByokCatalogProvider | null {
  const catalog = loadByokCatalog();
  // Prefer the PortLog/OMP connection id row when present (aliases + synthetics).
  if (catalog.providers[provider.trim()]) return catalog.providers[provider.trim()]!;
  const id = resolveByokProviderId(provider);
  return catalog.providers[id] ?? null;
}

/**
 * OMP registry order first (PortLog face), then remaining models.dev providers A–Z.
 */
export function byokProviderIndex(): ByokProviderIndexEntry[] {
  const catalog = loadByokCatalog();
  const supportedProviderIds = new Set(portlogSupportedProviderIds());
  const featured = catalog.featured.filter((id) => catalog.providers[id]);
  const featuredSet = new Set(featured);
  const rest = Object.keys(catalog.providers)
    .filter((id) => supportedProviderIds.has(id) && !featuredSet.has(id))
    .sort((a, b) => a.localeCompare(b));
  return [...featured, ...rest].map((id) => {
    const provider = catalog.providers[id]!;
    return {
      id,
      name: provider.name,
      doc: provider.doc,
      modelCount: provider.models.length,
      isLocal: provider.is_local === true,
      wire: provider.wire,
      baseUrl: provider.base_url,
    };
  });
}

export function byokProviderModels(provider: string): ReadonlyArray<ByokCatalogModel> {
  const direct = byokCatalogProvider(provider);
  if (direct && direct.models.length > 0) return direct.models;
  // Alias: e.g. moonshot → moonshotai models.
  const resolved = resolveByokProviderId(provider);
  if (resolved !== provider.trim()) {
    return loadByokCatalog().providers[resolved]?.models ?? direct?.models ?? [];
  }
  return direct?.models ?? [];
}
