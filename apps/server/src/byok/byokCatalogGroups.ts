import {
  loadByokCatalog,
  type ByokCatalog,
  type ByokCatalogModel,
} from "./byokCatalog.ts";

export type ByokCatalogGroupModel = ByokCatalogModel & {
  /** Exact catalog identity in provider/model form. */
  readonly qualifiedId: string;
};

export type ByokCatalogGroup = {
  /** Exact catalog provider identity. */
  readonly id: string;
  readonly name: string;
  readonly doc: string;
  readonly models: ReadonlyArray<ByokCatalogGroupModel>;
};

export type ListByokCatalogGroupsInput = {
  readonly query?: string;
  /** Supplying a catalog keeps the projection fully pure and deterministic. */
  readonly catalog?: ByokCatalog;
};

function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase();
}

function orderedProviderIds(catalog: ByokCatalog): ReadonlyArray<string> {
  const featured = catalog.featured.filter((id) => catalog.providers[id] !== undefined);
  const featuredSet = new Set(featured);
  const remaining = Object.keys(catalog.providers)
    .filter((id) => !featuredSet.has(id))
    .sort((left, right) => left.localeCompare(right));

  return [...featured, ...remaining];
}

function matchesQuery(value: string, query: string): boolean {
  return normalizeSearchText(value).includes(query);
}

function modelMatchesQuery(
  providerId: string,
  model: ByokCatalogModel,
  query: string,
): boolean {
  const qualifiedId = `${providerId}/${model.id}`;
  return (
    matchesQuery(model.id, query) ||
    matchesQuery(model.name, query) ||
    matchesQuery(qualifiedId, query)
  );
}

/**
 * Produces the offline catalog projection used by future provider/model surfaces.
 * A supplied catalog performs no I/O; the omitted-input form reads the canonical
 * checked-in catalog through the existing loader.
 */
export function listByokCatalogGroups(
  input: ListByokCatalogGroupsInput = {},
): ReadonlyArray<ByokCatalogGroup> {
  const catalog = input.catalog ?? loadByokCatalog();
  const query = normalizeSearchText(input.query ?? "");

  return orderedProviderIds(catalog).flatMap((id) => {
    const provider = catalog.providers[id]!;
    const providerMatches =
      query === "" || matchesQuery(id, query) || matchesQuery(provider.name, query);
    const models = provider.models
      .filter(
        (model) =>
          providerMatches ||
          modelMatchesQuery(id, model, query),
      )
      .map((model) => ({
        ...model,
        qualifiedId: `${id}/${model.id}`,
      }));

    if (query !== "" && models.length === 0) return [];

    return [
      {
        id,
        name: provider.name,
        doc: provider.doc,
        models,
      },
    ];
  });
}
