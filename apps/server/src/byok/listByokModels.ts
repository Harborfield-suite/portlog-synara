/**
 * Unified BYOK model listing: vendored catalogue + live OpenRouter / Gateway.
 * Returns vendored models immediately when live discovery fails or times out.
 */

import { byokProviderModels, type ByokCatalogModel } from "./byokCatalog.ts";
import { fetchOpenRouterModels } from "./openRouterModels.ts";
import {
  fetchVercelGatewayModels,
  VERCEL_AI_GATEWAY_PROVIDER_ID,
} from "./vercelGatewayModels.ts";

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
  options?: {
    readonly fetchImpl?: typeof fetch;
    readonly forceRefresh?: boolean;
  },
): Promise<ReadonlyArray<ListedByokModel>> {
  const id = provider.trim();
  if (id === "openrouter") {
    try {
      return await fetchOpenRouterModels({
        fetchImpl: options?.fetchImpl,
        forceRefresh: options?.forceRefresh,
      });
    } catch {
      return withToolFlag(byokProviderModels("openrouter"));
    }
  }
  if (id === VERCEL_AI_GATEWAY_PROVIDER_ID) {
    try {
      return await fetchVercelGatewayModels({
        fetchImpl: options?.fetchImpl,
        forceRefresh: options?.forceRefresh,
      });
    } catch {
      return [];
    }
  }
  if (id === "xai-oauth") {
    return withToolFlag(byokProviderModels("xai"));
  }
  return withToolFlag(byokProviderModels(id));
}
