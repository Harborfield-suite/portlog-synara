# Provider/model availability

**Status:** Ready for implementation

## Loop

Maintain the provider/model list that PortLog presents for agent work. OMP is
the source inventory and metadata reference, with concrete
`provider/model-id` identity. Synara keeps a product-owned snapshot of the OMP
data and updates it periodically when PortLog adds supported providers or OMP
adds models.

Reference source:

- [OMP providers](https://github.com/can1357/oh-my-pi/blob/main/docs/providers.md)
- [OMP model/provider configuration](https://github.com/can1357/oh-my-pi/blob/main/docs/models.md)
- [OMP bundled catalog models](https://github.com/can1357/oh-my-pi/tree/main/packages/catalog/src)

OMP is not an automatic admission list. A provider/model appears in the
PortLog list only after PortLog has an execution adapter and has deliberately
admitted that provider. Unsupported providers are not shown. Devin becomes
listed only as part of admitting its provider-specific adapter.

The runtime does not discover models from provider APIs. Catalog visibility and
runtime usability are separate states.

## Triggers

- On server startup, load the checked-in OMP-derived PortLog catalog snapshot.
- When provider credentials, endpoint settings, or provider enablement changes,
  recompute usability against the same snapshot.
- A maintainer publishes a catalog revision when syncing the snapshot with a
  newer OMP catalog or admitting a new provider/model.
- No continuous polling or provider model discovery is part of this workflow.

## Checkpoint

There is no checkpoint for loading or evaluating the catalog. The catalog is
product data, not a remote-discovery action. Human interaction begins when the
user selects a model, or when a provider is unavailable and the user must fix
its configuration.

## Source of truth

The checked-in OMP-derived PortLog catalog snapshot is authoritative. In the
current server layout, the snapshot is loaded from
`apps/server/src/data/model_catalog.json`; the implementation may relocate it
only if the same single checked-in source remains authoritative. A catalog
revision explicitly controls the visible provider and model set. Runtime
responses can never add, remove, or replace entries.

Each snapshot records its pinned OMP revision and sync date. Catalog entries
use exact provider/model identity; aliases are explicit data, not fuzzy runtime
matching.

## Usability

Every listed model remains visible when its provider is not usable. The UI
marks the provider/model as needing setup, explains the required credential or
endpoint, and disables selection/use. It does not hide supported models or
wait until turn start to report a missing credential.

A listed provider/model is available when its required credential/auth session
and endpoint configuration are resolvable and its PortLog execution adapter is
available. Catalog loading does not perform a live provider request. The
execution adapter remains the final fail-closed check and reports runtime
failures durably.

Credential usability is evaluated from existing server configuration/auth
state. The catalog does not contain secrets, require maintainers to possess
provider keys, or claim that PortLog operates a provider. Provider-published
capability and availability information remains the provider's responsibility;
PortLog links to that documentation and reports provider/runtime failures as
such.

The user-visible states are:

- **Available** — admitted provider, execution adapter present, and required
  configuration resolvable.
- **Needs setup** — admitted provider/model, but credentials or endpoint
  configuration are missing or incomplete.
- **Retired** — removed from the current catalog revision but retained for
  historical identity.

There is no **unsupported** state in the picker because unsupported providers
are not admitted to the list.

## Presentation

Show provider groups with searchable model rows. Each row includes the display
name and exact provider/model identity. Search matches provider names, model
names, and IDs. Unavailable entries remain visible and disabled with their setup
reason.

## Catalog metadata

Retain all runtime-relevant OMP metadata per admitted provider/model: provider
ID, model ID, display name, wire/API family, context and output limits,
reasoning/tool/input capabilities, pricing/usage metadata, and compatibility
fields needed by execution adapters. Do not copy generation-only or irrelevant
fields into Synara contracts without a use.

Retain each provider's published documentation and credential instructions as
links.

## Catalog update

For now, a maintainer intentionally syncs from a pinned OMP revision. The sync
records the upstream revision and date, reviews the provider/model diff, and
ships the resulting snapshot as a normal Synara change. There is no automated
upstream dependency or runtime network requirement.

A provider can be admitted without a provider key. Admission requires the
adapter contract and deterministic focused tests using mocked provider
responses, plus published provider/OMP metadata. It does not require a live
end-to-end request or maintained credentials. Provider service failures remain
provider/runtime failures, not catalog-admission failures.

When a revision removes an entry, retain its exact provider/model identity in
historical threads and mark it retired/unavailable. For a future turn whose
saved target is retired, automatically use the current global default model.
Record the substitution in durable turn metadata and show it in the turn
activity so the model change is not hidden. Do not rewrite historical identity.

## Current research constraint

The Devin example is a provider-specific transport integration, not a model
catalog discovery mechanism. Its provider is admitted only after the adapter
contract and deterministic behavior tests exist; then its OMP provider/model
metadata and provider documentation are added to the snapshot.

## Acceptance criteria

- The checked-in catalog is the only source of visible providers/models.
- The catalog contains only deliberately admitted providers with PortLog
  execution adapters.
- The snapshot records the pinned OMP revision and sync date.
- Provider/model identity is exact and stable as `provider/model-id`.
- Startup and provider-setting changes recompute usability without remote model
  discovery or maintained provider keys.
- Missing credentials or endpoint configuration leave entries visible but
  disabled with an actionable setup explanation.
- Provider groups support search by provider name, model name, and ID.
- Retired entries remain understandable in history and automatically fall back
  to the current global default for future turns, with the substitution recorded
  durably and shown in activity.
- Deterministic tests cover catalog loading, admission, usability states,
  search, and retired-model fallback.
