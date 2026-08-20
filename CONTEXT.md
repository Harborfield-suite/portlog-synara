# Domain Glossary

## PortLog
The product being designed and built in this repository. PortLog owns its provider catalog, model selection, credentials, authorization, runtime adapters, and harness execution policies. Legacy Synara model/provider behavior is not the product contract.

## Provider
An account or backend namespace that can route model requests, such as `anthropic`, `openai`, `openai-codex`, `devin`, or `ollama`. Provider identity determines catalog membership, credential resolution, availability, and request protocol.

## Provider identity
The stable provider ID used in a model's canonical identity and credential scope. `openai` (API access) and `openai-codex` (ChatGPT/Codex subscription OAuth) are distinct provider identities even when they expose overlapping model families.

## Access-path provider identity
A provider identity representing one materially distinct access path to a service. If credentials, entitlements, endpoint behavior, or model membership differ, PortLog uses a separate provider ID and catalog group rather than dynamically filtering one shared provider. Examples include `openai`, `openai-codex`, and potentially separate Anthropic API/credit and OAuth identities.

## Model
A concrete selectable model belonging to a provider. Its canonical identity is `provider/model-id`, such as `anthropic/claude-opus-4-6`. `openai/gpt-5.x` and `openai-codex/gpt-5.x` are distinct catalog entries.

## Provider catalog
The checked-in and human-curated set of provider and model metadata used to present and route selectable models. Catalog presence does not by itself mean that a model is available for execution.

## Curated catalog
PortLog's product-owned provider/model list. OMP is a high-trust reference for provider metadata and known working models, but PortLog may exclude, rename, add, or adjust entries to fit its own model-selection and authorization policies. Catalog changes are a human manual process; PortLog does not synchronize the OMP catalog at runtime.

## Catalog metadata
The broad provider/model facts PortLog intentionally records for product and routing use, informed by OMP-style metadata. This may include display identity, documentation, capabilities, modalities, reasoning support, context limits, output limits, pricing, release information, aliases, endpoint details, and adapter/auth declarations. Metadata is curated rather than blindly mirrored.

## PortLog-native catalog schema
The normalized provider/model data contract owned by PortLog. It captures broad catalog metadata and provenance without copying OMP configuration semantics. The schema is stable for PortLog consumers even when OMP changes its source shape.

## Provider-owned model membership
The explicit set of models offered by one provider identity. Providers may share model metadata or model IDs, but each provider owns its membership and may expose a different set based on its endpoint, credential type, commercial access, or documented restrictions. Therefore, separate providers such as `openai` and `openai-codex`, or `xai` and `xai-oauth`, may expose different numbers of models without that difference being an error.

## Proposed model
A model requested for addition to the curated catalog. A proposal needs a canonical provider/model identity, a trustworthy documentation reference that explicitly says the model supports tool or function calling, and its adapter family. No per-model live integration test is required by default.

## Tool-capable model
A catalog model whose trusted documentation states that it supports tool/function calling. Tool capability is the primary model-level requirement for PortLog harness execution.

## Adapter capability contract
The protocol-level behavior an adapter must support once per adapter family: tool definitions, streamed tool-call fragments, stable call identity, arguments, tool results, text/reasoning deltas, completion, cancellation, and errors. Models under that adapter inherit the contract.

## Documentation-led verification
The minimal model verification policy: trusted provider/model documentation establishes model tool-calling support; deterministic fixtures validate each provider adapter family; PortLog does not perform per-model live smoke tests by default.

## PortLog-native credential boundary
PortLog owns credential storage, provider-scoped account state, API-key/OAuth UI, refresh/logout behavior, and authorization decisions. OMP may inform provider-specific login behavior, but PortLog does not depend on OMP's credential database or internal auth lifecycle.

## PortLog auth store
PortLog's provider-scoped SQLite credential store, modeled after OMP's local `agent.db` approach but using a PortLog-owned location, schema, and lifecycle. It stores credential records and metadata needed for refresh, account labels, and status; it is not OMP's database. The initial implementation is local-first.

## PortLog credential-store interface
The abstraction used by the harness and provider adapters to resolve, test, refresh, and revoke credentials. The first implementation is the local PortLog auth store; a broker-backed implementation may replace it later without changing provider or tool callers.

## Remote credential broker
A future PortLog deployment mode modeled after OMP's auth broker. A broker host owns the canonical credential vault and OAuth refresh operation; clients receive redacted snapshots or broker-mediated provider access rather than raw refresh tokens. It is not required for the first credential milestone. Following the simple OMP-aligned scope, the broker may manage both OAuth and API credentials, with OAuth refresh tokens as the primary reason to use it.

## Remote broker use case
A remote broker is useful when many ephemeral or less-trusted clients—such as CI runners, containers, a shared development machine, or multiple developer laptops—need provider access without each storing long-lived OAuth refresh tokens. For example, a team can keep a ChatGPT/Codex OAuth refresh token on a protected broker, let an isolated PortLog worker request a short-lived access token or provider request through an authenticated gateway, and revoke that worker without redistributing the refresh token.

## Credential resolution order
The OMP-compatible precedence PortLog uses when several credential sources exist: (1) explicit runtime override, (2) provider configuration override, (3) stored OAuth credential with refresh, (4) stored provider API key, (5) provider environment-variable mapping, (6) broker-migrated or other secondary stored credential, and (7) provider fallback resolver. A configured provider `apiKey` is first interpreted as an environment-variable name and, if absent, as a literal token.

## Non-transferable credential
A credential authorizes only its declared provider identity and endpoint family. `openai-codex` OAuth does not authorize `openai` API models, even when the model IDs overlap; an OpenAI API key does not authorize ChatGPT/Codex subscription models.

## Active credential
The single credential used for a provider identity in the first PortLog phase. The data model should permit multiple stored accounts later, but initial UI and routing expose one active credential per access-path provider.

## Credential configured
A credential has been saved for a provider identity. Configuration alone does not prove that the credential or endpoint can execute a model.

## Credential ready
A configured credential has passed an explicit user-requested connection test or a bounded readiness check at turn start. PortLog does not probe every provider during startup.

## Provider health state
The durable last-known usability state for one provider identity. A successful explicit test or successful provider use records the provider as valid and keeps its green indicator across restarts. A definitive authentication or entitlement failure—such as an invalid API key, revoked OAuth credential, expired subscription, or provider response that denies model access—records the provider as invalid, changes the indicator to a hollow gray dot, and disables its model rows. Transient network failures and provider 5xx responses do not invalidate the provider.

## Secret obfuscation
Protection that prevents configured secrets and credential-shaped values from entering model-visible context or provider-visible tool payloads. PortLog may replace secrets with reversible placeholders for model interaction and restore them only at a local execution boundary when safe. Secret obfuscation is opt-in by default, matching OMP; enabling it is an explicit PortLog setting. When enabled, PortLog scans matching environment variables, global/project `secrets.yml` files, built-in credential-shaped token patterns, and registered PortLog auth-store credentials. It supports reversible `obfuscate` entries and explicitly irreversible `replace` entries.

## Reversible secret placeholder
An OMP-style deterministic placeholder substituted for a configured secret before provider-visible text is sent. PortLog restores it only at a trusted local execution boundary, such as execution of an authorized local tool; it must not restore the raw value into provider-visible content. Placeholder determinism uses a private per-install HMAC key persisted in the PortLog home directory, never sent to a provider, so placeholders remain stable across sessions and durable replay. If that key cannot be persisted, PortLog uses a process-ephemeral key, keeps protection active for the current process, and records a visible warning that placeholders will not be stable across restart.

## Irreversible secret replacement
A one-way secret substitution configured when a value must never be restored for tool execution or replay. The replacement remains in local and provider-visible representations.

## Secret capability
A declared permission that identifies which secret scope a tool may receive during local execution, such as `provider:openai`, `github:token`, or `env:package-registry`. PortLog checks the tool's declared secret capabilities before restoring a placeholder. A tool without the matching capability receives the placeholder or an explicit denial, never an automatic raw secret. Secret capabilities are useful only for tools that genuinely need credentials, such as private repository access, private package installation, cloud CLI operations, or registry publishing; ordinary read/edit/status tools do not receive secrets.

## Local secret injection
The preferred way for an authorized secret-capable local tool to receive a credential: PortLog binds the secret to a controlled environment, stdin, or provider-specific credential channel immediately before execution, rather than placing the raw value in model-visible text, command arguments, logs, or durable transcript data. Placeholder restoration in tool arguments is a compatibility path when the invocation explicitly contains a reversible placeholder.

## Secret injection binding
The mapping between a declared secret capability and the local delivery channel expected by a tool, such as `env:package-registry` to `NODE_AUTH_TOKEN` or a provider credential file. The binding is declared by the tool adapter or capability registry, not invented by the model at invocation time.

## Provider picker
The model-selection UI groups the full curated catalog by provider identity. `openai` and `openai-codex` appear as separate provider sections even when their model lists overlap; each section displays only the models belonging to that provider. Catalog membership and model count are provider-specific.

## Provider authentication indicator
The primary availability signal in the provider picker. A provider with a valid API key or authenticated OAuth credential displays a filled green dot. A provider without a valid configuration displays a gray hollow dot. The main picker does not need explicit `Ready` or `Configured` text; the indicator, model list, and provider detail/onboarding flow communicate the state. The indicator is persistent across restarts and is updated when a definitive provider failure is observed.

## Provider picker model visibility
Providers and their catalog models remain visible even when unauthenticated, so users can discover what each access path supports and configure it from the provider section. An unauthenticated provider may show its catalog model list and a gray hollow dot, but its model rows are browse-only and disabled: users cannot select an unauthenticated provider model. Authentication must succeed before a model becomes selectable.

## Unavailable global model
The previously selected provider/model identity whose provider has become invalid or whose model is no longer available. PortLog preserves the identity as the user's explicit choice for recovery and display, but does not treat it as an executable active model. The user must restore provider validity or select another enabled model; PortLog never silently substitutes another provider/model.

## Provider-scoped access rule
A documented or curated rule that filters a provider's model membership or availability by credential type, account entitlement, endpoint, or access program. Under the access-path identity rule, materially different access paths become separate provider identities instead of runtime filters.

## Global model default
The provider/model identity PortLog uses for the next turn unless the user deliberately changes the selection. The global default is persisted as the user's last-used model, including its provider identity; an existing or running turn keeps its captured selection.

## Selection failure
A fail-closed user-visible error when no model is selected for use or when the persisted global model becomes unavailable. PortLog does not silently substitute another provider or model. The user must configure or select an available model before starting a new turn.

## Active-turn credential refresh
When a credential expires during an active turn, PortLog may attempt the provider's normal refresh path once. If refresh fails, the current turn fails with a clear provider-specific reauthentication error; PortLog never changes provider or model and never waits indefinitely for user action.

## First-milestone credential onboarding
The initial PortLog credential surface: native API-key entry, secure persistence, masking, testing, removal, environment-variable support, and an OAuth extension point. Provider-specific OAuth flows are added where needed rather than required for every catalog provider before adoption.

## Model availability
The user-visible execution readiness of a model. A catalog model is available when its provider is enabled, its credentials or keyless-local conditions are satisfied, and the required endpoint and adapter are ready.

## Provider adapter
The runtime integration that translates the shared model/context/tool/stream contract into a provider's native request and response protocol. OpenAI-compatible endpoints may share an adapter; distinctive protocols such as Devin's Connect/protobuf API require a dedicated adapter.
