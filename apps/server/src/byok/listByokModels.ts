/**
 * Unified BYOK model listing from the checked-in catalog.
 *
 * Discovery options remain accepted for caller compatibility, but this
 * PortLog path is intentionally deterministic and offline.
 */

import { byokProviderModels, type ByokCatalogModel } from "./byokCatalog.ts";

export type ListedByokModel = ByokCatalogModel & {
  readonly toolCapable?: boolean;
};

function withToolFlag(
  models: ReadonlyArray<ByokCatalogModel>,
): ReadonlyArray<ListedByokModel> {
  return models.map((model) => ({ ...model, toolCapable: model.toolCapable ?? true }));
}

export async function listByokModelsForProvider(
  provider: string,
  _options?: {
    /** Accepted for compatibility; catalog listing never performs discovery. */
    readonly fetchImpl?: typeof fetch;
    /** Accepted for compatibility; catalog listing never refreshes remotely. */
    readonly forceRefresh?: boolean;
  },
): Promise<ReadonlyArray<ListedByokModel>> {
  const id = provider.trim();
  return withToolFlag(byokProviderModels(id === "xai-oauth" ? "xai" : id));
}
