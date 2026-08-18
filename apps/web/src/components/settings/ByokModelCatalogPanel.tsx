import type {
  ServerByokCatalogGroup,
  ServerByokCatalogGroupModel,
  ServerByokCatalogModel,
  ServerByokProviderIndexEntry,
} from "@synara/contracts";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import type { AppSettings } from "~/appSettings";
import {
  serverByokCatalogGroupsQueryOptions,
  serverByokProvidersQueryOptions,
} from "~/lib/serverReactQuery";
import { ensureNativeApi } from "~/nativeApi";
import { cn } from "~/lib/utils";
import {
  SETTINGS_INSET_LIST_CLASS_NAME,
  SETTINGS_STACKED_ROWS_DIVIDER_CLASS_NAME,
} from "~/settingsPanelStyles";

import { SettingsRow, SettingsSection } from "./SettingsPanelPrimitives";

export function isByokProviderUsable(
  provider: Pick<ServerByokProviderIndexEntry, "isLocal" | "status"> &
    Partial<Pick<ServerByokProviderIndexEntry, "apiKeyConfigured">>,
): boolean {
  return (
    provider.status === "connected" ||
    (provider.status === "checking" && provider.apiKeyConfigured === true) ||
    (provider.isLocal && provider.status !== "unavailable")
  );
}

export function modelsForSelectedByokProvider(input: {
  selectedProviderId: string;
  responseProvider: string | undefined;
  models: ReadonlyArray<ServerByokCatalogModel>;
}): ReadonlyArray<ServerByokCatalogModel> {
  return input.responseProvider === input.selectedProviderId ? input.models : [];
}

export function byokCatalogSearchQuery(query: string): string {
  return query.trim();
}

function isByokOAuthProvider(providerId: string): providerId is "openai-codex" | "cursor" {
  return providerId === "openai-codex" || providerId === "cursor";
}

export function byokCatalogModelSelection(input: {
  providerId: string;
  model: Pick<ServerByokCatalogGroupModel, "id" | "qualifiedId">;
}): Pick<AppSettings, "openaiCompatibleCatalogProviderId" | "openaiCompatibleDefaultModel"> {
  return {
    openaiCompatibleCatalogProviderId: input.providerId,
    openaiCompatibleDefaultModel: input.model.id,
  };
}

function providerStatusLabel(provider: ServerByokProviderIndexEntry | undefined): string {
  if (!provider) return "API key required";
  if (isByokProviderUsable(provider)) return provider.isLocal ? "Available locally" : "Ready";
  if (provider.status === "checking") return "Checking credentials";
  if (provider.status === "error") return "Credential error";
  if (provider.status === "unavailable") return "Unavailable";
  return "API key required";
}

function providerStatusReason(provider: ServerByokProviderIndexEntry | undefined): string {
  if (!provider) return "Set up this provider to select a model";
  if (isByokProviderUsable(provider)) return "Use model";
  if (provider.status === "checking") return "Waiting for credentials";
  if (provider.status === "error") return "Fix provider credentials";
  if (provider.status === "unavailable") return "Provider unavailable";
  return "Add provider API key";
}

export function ByokModelCatalogPanel(props: {
  settings: AppSettings;
  updateSettings: (patch: Partial<AppSettings>) => void;
}) {
  const [searchInput, setSearchInput] = useState("");
  const [setupProviderId, setSetupProviderId] = useState<string | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<
    "save" | "test" | "remove" | "oauth-login" | "oauth-logout" | null
  >(null);
  const searchQuery = byokCatalogSearchQuery(searchInput);
  const providersQuery = useQuery(serverByokProvidersQueryOptions());
  const catalogQuery = useQuery(serverByokCatalogGroupsQueryOptions(searchQuery));
  const providerById = useMemo(
    () => new Map((providersQuery.data?.providers ?? []).map((provider) => [provider.id, provider])),
    [providersQuery.data?.providers],
  );
  const groups = catalogQuery.data?.groups ?? [];

  const refreshProviderData = async () => {
    await Promise.all([providersQuery.refetch(), catalogQuery.refetch()]);
  };

  const runOAuthAction = async (
    action: "login" | "logout",
    providerId: "openai-codex" | "cursor",
  ) => {
    if (busyAction) return;
    setBusyAction(action === "login" ? "oauth-login" : "oauth-logout");
    setActionError(null);
    try {
      const api = ensureNativeApi();
      if (action === "login") await api.server.startByokOAuth({ provider: providerId });
      else await api.server.logoutByokOAuth({ provider: providerId });
      await api.server.refreshProviders();
      await refreshProviderData();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "OAuth update failed.");
    } finally {
      setBusyAction(null);
    }
  };

  const runCredentialAction = async (
    action: "save" | "test" | "remove",
    providerId: string,
  ) => {
    if (busyAction) return;
    setBusyAction(action);
    setActionError(null);
    try {
      const api = ensureNativeApi();
      if (action === "test") {
        await api.server.testByokConnection({ provider: providerId });
      } else {
        await api.server.setByokApiKey({
          provider: providerId,
          apiKey: action === "remove" ? null : apiKeyInput,
        });
        setApiKeyInput("");
        if (action === "remove") setSetupProviderId(null);
      }
      await refreshProviderData();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Provider credential update failed.");
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <SettingsSection title="BYOK model catalog">
      <SettingsRow
        title="Supported models"
        description="Browse the tool-capable models PortLog supports. A provider credential is required before a model can be selected for use."
        status={catalogQuery.isLoading ? "Loading catalog" : `${groups.length} providers`}
      >
        {catalogQuery.isError ? (
          <p className="mt-3 text-xs text-muted-foreground">
            The model catalog is temporarily unavailable. Try reopening Settings.
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            <label className="block">
              <span className="block text-xs font-medium text-foreground">Search providers or models</span>
              <input
                type="search"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Search providers or models"
                aria-label="Search providers or models"
                className={cn(
                  "mt-1 block w-full px-2.5 py-2 text-sm text-foreground outline-none",
                  "rounded-md border border-border bg-background",
                )}
              />
            </label>

            <div className={SETTINGS_INSET_LIST_CLASS_NAME}>
              <div className="flex items-center justify-between gap-3 px-3 py-2 text-xs text-muted-foreground">
                <span>Provider groups</span>
                <span>{groups.length} providers</span>
              </div>
              <div className={cn("max-h-72 overflow-y-auto", SETTINGS_STACKED_ROWS_DIVIDER_CLASS_NAME)}>
                {catalogQuery.isLoading ? (
                  <p className="px-3 py-3 text-xs text-muted-foreground">Loading models…</p>
                ) : groups.length === 0 ? (
                  <p className="px-3 py-3 text-xs text-muted-foreground">No supported models listed.</p>
                ) : (
                  groups.map((group: ServerByokCatalogGroup) => {
                    const provider = providerById.get(group.id);
                    const oauthProvider = isByokOAuthProvider(group.id) ? group.id : null;
                    const canSelectModels = provider ? isByokProviderUsable(provider) : false;
                    return (
                      <section key={group.id} aria-label={group.name}>
                        <div className="flex items-start justify-between gap-3 bg-muted/30 px-3 py-2">
                          <span className="min-w-0">
                            <span className="block truncate text-xs font-medium text-foreground">
                              {group.name}
                            </span>
                            <span className="block truncate font-mono text-[11px] text-muted-foreground">
                              {group.id} · {group.models.length} {group.models.length === 1 ? "model" : "models"}
                            </span>
                          </span>
                          <span className="flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
                            <span>{providerStatusLabel(provider)}</span>
                            <button
                              type="button"
                              className="rounded border border-border px-1.5 py-0.5 text-foreground hover:bg-muted"
                              aria-label={`Configure ${group.name}`}
                              onClick={() => {
                                setSetupProviderId((current) => (current === group.id ? null : group.id));
                                setActionError(null);
                              }}
                            >
                              {setupProviderId === group.id ? "Close" : "Configure"}
                            </button>
                          </span>
                        </div>
                        {setupProviderId === group.id ? (
                          <div className="space-y-2 border-b border-border px-3 py-3">
                            <label className="block text-xs font-medium text-foreground">
                              API key
                              <input
                                type="password"
                                value={apiKeyInput}
                                onChange={(event) => setApiKeyInput(event.target.value)}
                                placeholder={provider?.maskedKeySuffix ?? "Paste an API key"}
                                aria-label={`${group.name} API key`}
                                autoComplete="off"
                                className="mt-1 block w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none"
                              />
                            </label>
                            {provider?.envVar ? (
                              <p className="text-[11px] text-muted-foreground">
                                Environment variable: <code>{provider.envVar}</code>
                              </p>
                            ) : null}
                            {actionError ? (
                              <p className="text-[11px] text-destructive">{actionError}</p>
                            ) : null}
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                disabled={busyAction !== null || apiKeyInput.trim().length === 0}
                                className="rounded bg-foreground px-2 py-1 text-[11px] text-background disabled:cursor-not-allowed disabled:opacity-50"
                                onClick={() => void runCredentialAction("save", group.id)}
                              >
                                {busyAction === "save" ? "Saving…" : "Save & test"}
                              </button>
                              <button
                                type="button"
                                disabled={busyAction !== null || !provider?.apiKeyConfigured}
                                className="rounded border border-border px-2 py-1 text-[11px] text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                                onClick={() => void runCredentialAction("test", group.id)}
                              >
                                {busyAction === "test" ? "Testing…" : "Test connection"}
                              </button>
                              <button
                                type="button"
                                disabled={busyAction !== null || !provider?.apiKeyConfigured}
                                className="rounded border border-border px-2 py-1 text-[11px] text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
                                onClick={() => void runCredentialAction("remove", group.id)}
                              >
                                {busyAction === "remove" ? "Removing…" : "Remove key"}
                              </button>
                              {provider?.supportedAuth?.includes("oauth") && oauthProvider ? (
                                <>
                                  <button
                                    type="button"
                                    disabled={busyAction !== null}
                                    className="rounded border border-border px-2 py-1 text-[11px] text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                                    onClick={() => void runOAuthAction("login", oauthProvider)}
                                  >
                                    {busyAction === "oauth-login" ? "Opening login…" : "Log in with OAuth"}
                                  </button>
                                  <button
                                    type="button"
                                    disabled={busyAction !== null || provider.auth !== "oauth"}
                                    className="rounded border border-border px-2 py-1 text-[11px] text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
                                    onClick={() => void runOAuthAction("logout", oauthProvider)}
                                  >
                                    {busyAction === "oauth-logout" ? "Logging out…" : "Log out"}
                                  </button>
                                </>
                              ) : null}
                            </div>
                          </div>
                        ) : null}
                        {group.models.length === 0 ? (
                          <p className="px-3 py-3 text-xs text-muted-foreground">No supported models listed.</p>
                        ) : (
                          group.models.map((model) => {
                            const selected =
                              props.settings.openaiCompatibleCatalogProviderId === group.id &&
                              props.settings.openaiCompatibleDefaultModel === model.id;
                            return (
                              <button
                                key={model.qualifiedId}
                                type="button"
                                disabled={!canSelectModels}
                                className={cn(
                                  "flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors",
                                  canSelectModels ? "hover:bg-muted/60" : "cursor-not-allowed opacity-65",
                                  selected && "bg-muted/50",
                                )}
                                onClick={() => {
                                  if (!canSelectModels) return;
                                  props.updateSettings(
                                    byokCatalogModelSelection({ providerId: group.id, model }),
                                  );
                                }}
                              >
                                <span className="min-w-0">
                                  <span className="block truncate text-xs font-medium text-foreground">
                                    {model.name}
                                  </span>
                                  <span className="block truncate font-mono text-[11px] text-muted-foreground">
                                    {model.qualifiedId}
                                  </span>
                                </span>
                                <span className="shrink-0 text-[11px] text-muted-foreground">
                                  {providerStatusReason(provider)}
                                </span>
                              </button>
                            );
                          })
                        )}
                      </section>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}
      </SettingsRow>
    </SettingsSection>
  );
}
