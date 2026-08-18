// FILE: ProviderModelPicker.tsx
// Purpose: Renders the composer provider/model menu and supports controlled opening for shortcuts.
// Layer: Chat composer presentation
// Depends on: provider availability metadata, shared menu primitives, and picker trigger styling.

import {
  PROVIDER_DISPLAY_NAMES,
  type ModelSlug,
  type ProviderKind,
  type ServerByokCatalogGroup,
  type ServerByokProviderIndexEntry,
  type ServerProviderStatus,
} from "@synara/contracts";
import { resolveSelectableModel } from "@synara/shared/model";
import { providerSupportsOAuthSetup } from "@synara/shared/providerMetadata";
import * as Schema from "effect/Schema";
import { useDeferredValue, useEffect, useRef, useState } from "react";
import { type ProviderPickerKind, PROVIDER_OPTIONS } from "../../session-logic";
import { formatProviderModelOptionName } from "../../providerModelOptions";
import { compareProvidersByOrder } from "../../providerOrdering";
import {
  Menu,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubTrigger,
  MenuTrigger,
} from "../ui/menu";
import { PROVIDER_ICON_COMPONENT_BY_PROVIDER } from "../ProviderIcon";
import { ModelBrandIcon } from "../ModelBrandIcon";
import { cn } from "~/lib/utils";
import { PickerPanelShell } from "./PickerPanelShell";
import { PickerTriggerButton } from "./PickerTriggerButton";
import { ProviderModelOptionGroupList } from "./ProviderModelOptionGroupList";
import { ComposerPickerMenuPopup, ComposerPickerMenuSubPopup } from "./ComposerPickerMenuPopup";
import {
  COMPOSER_PICKER_MODEL_LIST_MAX_HEIGHT_CLASS_NAME,
  COMPOSER_PICKER_MODEL_LIST_SCROLL_CLASS_NAME,
  COMPOSER_PICKER_MODEL_SUBMENU_HEIGHT_CLASS_NAME,
} from "./composerPickerStyles";
import { ShortcutKbd } from "../ui/shortcut-kbd";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  groupProviderModelOptions,
  groupProviderModelOptionsWithFavorites,
  shouldUseCollapsibleModelGroups,
  type ProviderModelOption,
} from "../../providerModelOptions";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import {
  FAVORITE_MODEL_STORAGE_KEYS,
  supportsModelFavorites,
  type FavoriteModelProvider,
} from "../../lib/modelFavorites";
import { Skeleton } from "../ui/skeleton";

function isAvailableProviderOption(option: (typeof PROVIDER_OPTIONS)[number]): option is {
  value: ProviderKind;
  label: string;
  available: true;
} {
  return option.available;
}

function resolveLiveProviderAvailability(provider: ServerProviderStatus | undefined): {
  disabled: boolean;
  label: string | null;
} {
  if (!provider) {
    return {
      disabled: true,
      label: "Checking",
    };
  }

  if (!provider.available) {
    return {
      disabled: true,
      label:
        provider.authStatus === "unauthenticated"
          ? "Sign in"
          : providerSupportsOAuthSetup(provider.provider)
            ? "Set up"
            : "Unavailable",
    };
  }

  if (provider.authStatus === "unauthenticated") {
    return {
      disabled: true,
      label: "Sign in",
    };
  }

  return {
    disabled: false,
    label: null,
  };
}

export const AVAILABLE_PROVIDER_OPTIONS = PROVIDER_OPTIONS.filter(isAvailableProviderOption);
const UNAVAILABLE_PROVIDER_OPTIONS = PROVIDER_OPTIONS.filter((option) => !option.available);

// Removes user-hidden providers from a provider option list while always
// preserving any providers the caller marks as protected (the active and
// locked provider for the current thread). Without that carve-out, hiding the
// provider you're already using would erase the entry that lets you switch
// away from it.
function filterProviderOptionsByVisibility<T extends { value: ProviderKind }>(
  options: ReadonlyArray<T>,
  hiddenProviders: ReadonlySet<ProviderKind>,
  protectedProviders: ReadonlySet<ProviderKind>,
): ReadonlyArray<T> {
  if (hiddenProviders.size === 0) {
    return options;
  }
  return options.filter(
    (option) => protectedProviders.has(option.value) || !hiddenProviders.has(option.value),
  );
}

function providerIconClassName(
  provider: ProviderKind | ProviderPickerKind,
  fallbackClassName: string,
): string {
  return provider === "claudeAgent" || provider === "antigravity" || provider === "pi"
    ? "text-foreground"
    : fallbackClassName;
}

const SEARCHABLE_MODEL_PICKER_THRESHOLD = 15;
const FavoriteModelSlugs = Schema.Array(Schema.String);
const EMPTY_FAVORITE_MODEL_SLUGS: ReadonlyArray<string> = [];

// Keeps persisted favorite slugs compact and stable while preserving the user's order.
function toggleFavoriteModelSlug(current: ReadonlyArray<string>, slug: string): string[] {
  const normalizedCurrent = Array.from(new Set(current.filter((entry) => entry.trim().length > 0)));
  return normalizedCurrent.includes(slug)
    ? normalizedCurrent.filter((entry) => entry !== slug)
    : [...normalizedCurrent, slug];
}

function stripParameterizedModelSuffix(model: string): string {
  return model.trim().replace(/\[[^\]]*\]$/u, "");
}

function resolveSelectedModelLabel(input: {
  provider: ProviderKind;
  model: string;
  options: ReadonlyArray<ProviderModelOption>;
}): string {
  const exact = input.options.find((option) => option.slug === input.model);
  if (exact) {
    return exact.name;
  }
  if (input.provider === "cursor") {
    const baseModel = stripParameterizedModelSuffix(input.model);
    const baseMatch = input.options.find(
      (option) => stripParameterizedModelSuffix(option.slug) === baseModel,
    );
    if (baseMatch) {
      return baseMatch.name;
    }
  }
  return formatProviderModelOptionName({
    provider: input.provider,
    slug: input.model,
  });
}

function encodeProviderModelSelection(provider: ProviderKind, model: string): string {
  return JSON.stringify([provider, model]);
}

function decodeProviderModelSelection(value: string): { provider: ProviderKind; model: string } | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      Array.isArray(parsed) &&
      typeof parsed[0] === "string" &&
      typeof parsed[1] === "string"
    ) {
      return { provider: parsed[0] as ProviderKind, model: parsed[1] };
    }
  } catch {
    // Ignore malformed menu values; they cannot come from this picker.
  }
  return null;
}

export function resolveProviderPickerLabel(
  provider: ProviderKind,
  options: ReadonlyArray<ProviderModelOption>,
): string {
  if (provider === "openaiCompatible") {
    const upstreamNames = Array.from(
      new Set(
        options
          .map((option) => option.upstreamProviderName?.trim())
          .filter((name): name is string => Boolean(name)),
      ),
    );
    const onlyUpstreamName = upstreamNames[0];
    if (onlyUpstreamName) return onlyUpstreamName;
  }
  return PROVIDER_DISPLAY_NAMES[provider];
}

function buildModelMetadata(
  option: ProviderModelOption,
  providerLabel: string,
  availabilityLabel: string | null,
): string {
  const upstreamProvider = option.upstreamProviderName ?? option.upstreamProviderId;
  return [
    availabilityLabel,
    upstreamProvider === providerLabel ? undefined : upstreamProvider,
    option.description,
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" · ");
}

function buildModelSearchText(option: ProviderModelOption): string {
  return [
    option.name,
    option.slug,
    option.description,
    option.upstreamProviderName,
    option.upstreamProviderId,
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ")
    .toLowerCase();
}

export type ProviderModelMenuItemsProps = {
  provider: ProviderKind;
  model: ModelSlug;
  lockedProvider: ProviderKind | null;
  providers?: ReadonlyArray<ServerProviderStatus>;
  modelOptionsByProvider: Record<ProviderKind, ReadonlyArray<ProviderModelOption>>;
  loadingModelProviders?: Partial<Record<ProviderKind, boolean>>;
  hiddenProviders?: ReadonlyArray<ProviderKind>;
  providerOrder?: ReadonlyArray<ProviderKind>;
  disabled?: boolean;
  modelSelectionMode?: "provider-first" | "model-first";
  onProviderModelChange: (provider: ProviderKind, model: ModelSlug) => void;
  // Invoked after a model selection commits so callers can close ancestor
  // menus and refocus the composer.
  onAfterSelection?: () => void;
};

// Renders only the popup body of the provider/model picker. Designed to be
// dropped into any shared picker popup or submenu so the same selection logic can
// be reused by the standalone picker and the combined composer trait picker.
export const ProviderModelMenuItems = function ProviderModelMenuItems(
  props: ProviderModelMenuItemsProps,
) {
  const { onAfterSelection } = props;
  const [modelSearchQuery, setModelSearchQuery] = useState("");
  const [modelProviderFilter, setModelProviderFilter] = useState<ProviderKind | "all">("all");
  const [kiloFavoriteModelSlugs, setKiloFavoriteModelSlugs] = useLocalStorage(
    FAVORITE_MODEL_STORAGE_KEYS.kilo,
    EMPTY_FAVORITE_MODEL_SLUGS,
    FavoriteModelSlugs,
  );
  const [cursorFavoriteModelSlugs, setCursorFavoriteModelSlugs] = useLocalStorage(
    FAVORITE_MODEL_STORAGE_KEYS.cursor,
    EMPTY_FAVORITE_MODEL_SLUGS,
    FavoriteModelSlugs,
  );
  const [openCodeFavoriteModelSlugs, setOpenCodeFavoriteModelSlugs] = useLocalStorage(
    FAVORITE_MODEL_STORAGE_KEYS.opencode,
    EMPTY_FAVORITE_MODEL_SLUGS,
    FavoriteModelSlugs,
  );
  const [piFavoriteModelSlugs, setPiFavoriteModelSlugs] = useLocalStorage(
    FAVORITE_MODEL_STORAGE_KEYS.pi,
    EMPTY_FAVORITE_MODEL_SLUGS,
    FavoriteModelSlugs,
  );
  const deferredModelSearchQuery = useDeferredValue(modelSearchQuery);
  const activeProvider = props.lockedProvider ?? props.provider;
  const hiddenProviders = props.hiddenProviders;
  const providerOrder = props.providerOrder;
  const hiddenProviderSet = new Set<ProviderKind>(hiddenProviders ?? []);
  const protectedProviderSet = new Set<ProviderKind>([props.provider]);
  if (props.lockedProvider !== null) {
    protectedProviderSet.add(props.lockedProvider);
  }
  const visibleAvailableProviderOptions = filterProviderOptionsByVisibility(
    AVAILABLE_PROVIDER_OPTIONS.toSorted((left, right) =>
      compareProvidersByOrder(providerOrder ?? [], left.value, right.value),
    ),
    hiddenProviderSet,
    protectedProviderSet,
  );
  const visibleUnavailableProviderOptions = filterProviderOptionsByVisibility(
    UNAVAILABLE_PROVIDER_OPTIONS.toSorted((left, right) =>
      compareProvidersByOrder(providerOrder ?? [], left.value, right.value),
    ),
    hiddenProviderSet,
    protectedProviderSet,
  );
  const kiloFavoriteModelSlugSet = new Set(kiloFavoriteModelSlugs);
  const openCodeFavoriteModelSlugSet = new Set(openCodeFavoriteModelSlugs);
  const cursorFavoriteModelSlugSet = new Set(cursorFavoriteModelSlugs);
  const piFavoriteModelSlugSet = new Set(piFavoriteModelSlugs);
  const favoriteModelSlugSets = {
    cursor: cursorFavoriteModelSlugSet,
    kilo: kiloFavoriteModelSlugSet,
    opencode: openCodeFavoriteModelSlugSet,
    pi: piFavoriteModelSlugSet,
  };
  const handleModelChange = (provider: ProviderKind, value: string) => {
    if (props.disabled) return;
    if (!value) return;
    const resolvedModel = resolveSelectableModel(
      provider,
      value,
      props.modelOptionsByProvider[provider],
    );
    if (!resolvedModel) return;
    props.onProviderModelChange(provider, resolvedModel);
    onAfterSelection?.();
  };
  const toggleFavoriteModel = (provider: FavoriteModelProvider, slug: string) => {
    const setFavoriteModelSlugs =
      provider === "cursor"
        ? setCursorFavoriteModelSlugs
        : provider === "kilo"
          ? setKiloFavoriteModelSlugs
          : provider === "pi"
            ? setPiFavoriteModelSlugs
            : setOpenCodeFavoriteModelSlugs;
    setFavoriteModelSlugs((current) => toggleFavoriteModelSlug(current, slug));
  };

  const renderModelRadioGroup = (provider: ProviderKind) => {
    if (props.loadingModelProviders?.[provider]) {
      return (
        <div className="space-y-2 px-2 py-2" aria-label="Loading models">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="flex items-center gap-2 rounded-md px-2 py-1.5">
              <Skeleton className="size-3.5 rounded-full" />
              <Skeleton className={cn("h-3.5 rounded-full", index % 3 === 0 ? "w-24" : "w-32")} />
            </div>
          ))}
        </div>
      );
    }

    const providerOptions = props.modelOptionsByProvider[provider];
    const availability = props.providers
      ? resolveLiveProviderAvailability(
          props.providers.find((entry) => entry.provider === provider),
        )
      : { disabled: false, label: null };
    const shouldShowSearch =
      (provider === "kilo" ||
        provider === "opencode" ||
        provider === "cursor" ||
        provider === "pi") &&
      providerOptions.length >= SEARCHABLE_MODEL_PICKER_THRESHOLD;
    const normalizedModelSearchQuery = deferredModelSearchQuery.trim().toLowerCase();
    const filteredOptions =
      shouldShowSearch && normalizedModelSearchQuery.length > 0
        ? providerOptions.filter((option) =>
            buildModelSearchText(option).includes(normalizedModelSearchQuery),
          )
        : providerOptions;
    const favoriteProvider = supportsModelFavorites(provider) ? provider : null;
    const favoriteModelSlugSet =
      favoriteProvider !== null ? favoriteModelSlugSets[favoriteProvider] : undefined;
    const groupedOptions =
      favoriteModelSlugSet !== undefined
        ? groupProviderModelOptionsWithFavorites({
            options: filteredOptions,
            favoriteSlugs: favoriteModelSlugSet,
          })
        : groupProviderModelOptions(filteredOptions);

    const content =
      groupedOptions.length > 0 ? (
        <MenuRadioGroup
          value={activeProvider === provider ? props.model : ""}
          onValueChange={(value) => {
            if (availability.disabled) return;
            handleModelChange(provider, value);
          }}
        >
          <ProviderModelOptionGroupList
            groupedOptions={groupedOptions}
            provider={provider}
            activeModel={props.model}
            isSearching={normalizedModelSearchQuery.length > 0}
            favoriteProvider={favoriteProvider}
            favoriteModelSlugSet={favoriteModelSlugSet}
            onToggleFavorite={toggleFavoriteModel}
            disabled={availability.disabled}
            {...(onAfterSelection ? { onAfterSelection } : {})}
          />
        </MenuRadioGroup>
      ) : (
        <div className="px-2 py-2 text-muted-foreground text-sm">
          {provider === "pi" && normalizedModelSearchQuery.length === 0
            ? "No Pi models found"
            : "No matches"}
        </div>
      );

    const availabilityNotice = availability.disabled ? (
      <div role="status" className="px-2 py-1.5 text-[11px] text-muted-foreground">
        {availability.label}
      </div>
    ) : null;

    if (!shouldShowSearch) {
      const needsScrollContainer =
        filteredOptions.length >= SEARCHABLE_MODEL_PICKER_THRESHOLD ||
        shouldUseCollapsibleModelGroups(groupedOptions.length, false);
      if (needsScrollContainer) {
        return (
          <div
            className={cn(
              "overflow-y-auto overscroll-contain py-0.5",
              COMPOSER_PICKER_MODEL_LIST_SCROLL_CLASS_NAME,
              COMPOSER_PICKER_MODEL_LIST_MAX_HEIGHT_CLASS_NAME,
            )}
          >
            {availabilityNotice}
            {content}
          </div>
        );
      }
      return (
        <>
          {availabilityNotice}
          {content}
        </>
      );
    }

    return (
      <PickerPanelShell
        searchPlaceholder="Search models or providers"
        query={modelSearchQuery}
        onQueryChange={setModelSearchQuery}
        stopSearchKeyPropagation
        autoFocusSearch
        widthClassName="w-full"
        bleedParentPadding
        listMaxHeightClassName={COMPOSER_PICKER_MODEL_LIST_MAX_HEIGHT_CLASS_NAME}
      >
        {availabilityNotice}
        {content}
      </PickerPanelShell>
    );
  };

  if (props.lockedProvider !== null) {
    return <>{renderModelRadioGroup(props.lockedProvider)}</>;
  }

  if (props.modelSelectionMode === "model-first") {
    const query = deferredModelSearchQuery.trim().toLowerCase();
    const modelFirstProviders = visibleAvailableProviderOptions.map((providerOption) => {
      const provider = providerOption.value;
      const liveProvider = props.providers?.find((entry) => entry.provider === provider);
      return {
        provider,
        availability: props.providers
          ? resolveLiveProviderAvailability(liveProvider)
          : { disabled: false, label: null },
      };
    });
    const flatOptions = modelFirstProviders.flatMap(({ provider, availability }) =>
      props.modelOptionsByProvider[provider].map((option) => ({ provider, option, availability })),
    );
    const modelCountByProvider = new Map<ProviderKind, number>();
    for (const { provider } of flatOptions) {
      modelCountByProvider.set(provider, (modelCountByProvider.get(provider) ?? 0) + 1);
    }
    const providerFilteredOptions =
      modelProviderFilter === "all"
        ? flatOptions
        : flatOptions.filter(({ provider }) => provider === modelProviderFilter);
    const filteredOptions =
      query.length === 0
        ? providerFilteredOptions
        : providerFilteredOptions.filter(({ provider, option }) =>
            (buildModelSearchText(option) + " " + PROVIDER_DISPLAY_NAMES[provider])
              .toLowerCase()
              .includes(query),
          );
    const content =
      filteredOptions.length > 0 ? (
        <MenuRadioGroup
          value={encodeProviderModelSelection(activeProvider, props.model)}
          onValueChange={(value) => {
            const selection = decodeProviderModelSelection(value);
            if (selection) {
              handleModelChange(selection.provider, selection.model);
            }
          }}
        >
          <div className="model-picker-frame-table-body">
            {filteredOptions.map(({ provider, option, availability }) => {
              const providerLabel = resolveProviderPickerLabel(
                provider,
                props.modelOptionsByProvider[provider],
              );
              return (
                <MenuRadioItem
                  key={provider + ":" + option.slug}
                  value={encodeProviderModelSelection(provider, option.slug)}
                  disabled={availability.disabled}
                  className="model-picker-frame-model-row"
                >
                  <span className="model-picker-frame-model-primary">
                    <ModelBrandIcon
                      option={option}
                      provider={provider}
                      aria-hidden="true"
                      className="model-picker-frame-model-icon"
                    />
                    <span className="min-w-0">
                      <span className="model-picker-frame-model-name">{option.name}</span>
                      <span className="model-picker-frame-model-provider">{providerLabel}</span>
                    </span>
                  </span>
                  <span className="model-picker-frame-model-metadata">
                    {buildModelMetadata(option, providerLabel, availability.label)}
                  </span>
                </MenuRadioItem>
              );
            })}
          </div>
        </MenuRadioGroup>
      ) : (
        <div className="model-picker-frame-empty">No matching models</div>
      );
    return (
      <div className="model-picker-frame">
        <aside className="model-picker-frame-rail" aria-label="Filter models by provider">
          <div className="model-picker-frame-rail-heading">Providers</div>
          <div className="model-picker-frame-provider-list">
            <button
              type="button"
              className="model-picker-frame-provider-button"
              data-active={modelProviderFilter === "all" ? "" : undefined}
              aria-pressed={modelProviderFilter === "all"}
              onClick={() => setModelProviderFilter("all")}
            >
              <span className="model-picker-frame-provider-label">
                <span className="model-picker-frame-status-dot" aria-hidden="true" />
                All models
              </span>
              <span className="model-picker-frame-provider-count">{flatOptions.length}</span>
            </button>
            {modelFirstProviders.map(({ provider, availability }) => {
              const ProviderIcon = PROVIDER_ICON_COMPONENT_BY_PROVIDER[provider];
              const modelCount = modelCountByProvider.get(provider) ?? 0;
              const providerLabel = resolveProviderPickerLabel(
                provider,
                props.modelOptionsByProvider[provider],
              );
              return (
                <button
                  key={provider}
                  type="button"
                  className="model-picker-frame-provider-button"
                  data-active={modelProviderFilter === provider ? "" : undefined}
                  aria-pressed={modelProviderFilter === provider}
                  onClick={() => setModelProviderFilter(provider)}
                >
                  <span className="model-picker-frame-provider-label">
                    <span
                      className="model-picker-frame-status-dot"
                      data-live={availability.disabled ? undefined : ""}
                      aria-label={availability.disabled ? availability.label ?? "Unavailable" : undefined}
                    />
                    <ProviderIcon aria-hidden="true" className="model-picker-frame-provider-icon" />
                    <span className="truncate">{providerLabel}</span>
                  </span>
                  <span className="model-picker-frame-provider-count">{modelCount}</span>
                  {availability.disabled ? (
                    <span className="model-picker-frame-provider-status">{availability.label}</span>
                  ) : null}
                </button>
              );
            })}
            {visibleUnavailableProviderOptions.map((option) => {
              const ProviderIcon = PROVIDER_ICON_COMPONENT_BY_PROVIDER[option.value];
              const providerLabel = resolveProviderPickerLabel(
                option.value,
                props.modelOptionsByProvider[option.value],
              );
              return (
                <div
                  key={option.value}
                  className="model-picker-frame-provider-button cursor-not-allowed opacity-50"
                  aria-disabled="true"
                >
                  <span className="model-picker-frame-provider-label">
                    <span
                      className="model-picker-frame-status-dot"
                      aria-label="Unavailable"
                    />
                    <ProviderIcon aria-hidden="true" className="model-picker-frame-provider-icon" />
                    <span className="truncate">{providerLabel}</span>
                  </span>
                  <span className="model-picker-frame-provider-count">0</span>
                  <span className="model-picker-frame-provider-status">Unavailable</span>
                </div>
              );
            })}
          </div>
          <div className="model-picker-frame-settings">Settings</div>
        </aside>
        <section className="model-picker-frame-main" aria-label="Available models">
          <header className="model-picker-frame-header">
            <div>
              <h2 className="model-picker-frame-title">Models</h2>
              <p className="model-picker-frame-subtitle">All available models</p>
            </div>
            <label className="model-picker-frame-search-label">
              <span className="sr-only">Search models or providers</span>
              <input
                autoFocus
                className="model-picker-frame-search"
                type="search"
                placeholder="Search models or providers"
                value={modelSearchQuery}
                onChange={(event) => setModelSearchQuery(event.target.value)}
                onKeyDownCapture={(event) => {
                  if (
                    !["ArrowDown", "ArrowUp", "Home", "End", "PageDown", "PageUp", "Enter", "Escape"].includes(
                      event.key,
                    )
                  ) {
                    event.stopPropagation();
                  }
                }}
              />
            </label>
          </header>
          <div className="model-picker-frame-table">
            <div className="model-picker-frame-table-header" aria-hidden="true">
              <span>Provider / model</span>
              <span>Provenance or description</span>
            </div>
            <div className="model-picker-frame-scroll">{content}</div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <>
      {visibleAvailableProviderOptions.map((option) => {
        const OptionIcon = PROVIDER_ICON_COMPONENT_BY_PROVIDER[option.value];
        const providerLabel = resolveProviderPickerLabel(
          option.value,
          props.modelOptionsByProvider[option.value],
        );
        const liveProvider = props.providers?.find((entry) => entry.provider === option.value);
        const availability = resolveLiveProviderAvailability(liveProvider);
        if (availability.disabled) {
          return (
            <MenuItem key={option.value} disabled>
              <OptionIcon
                aria-hidden="true"
                className={cn(
                  "size-3 shrink-0 opacity-80",
                  providerIconClassName(option.value, "text-muted-foreground/85"),
                )}
              />
              <span>{providerLabel}</span>
              <span className="ms-auto text-[11px] text-muted-foreground/80">
                {availability.label}
              </span>
            </MenuItem>
          );
        }
        return (
          <MenuSub key={option.value}>
            <MenuSubTrigger>
              <OptionIcon
                aria-hidden="true"
                className={cn(
                  "size-3 shrink-0",
                  providerIconClassName(option.value, "text-muted-foreground/85"),
                )}
              />
              {providerLabel}
            </MenuSubTrigger>
            <ComposerPickerMenuSubPopup
              fixedWidth
              className={COMPOSER_PICKER_MODEL_SUBMENU_HEIGHT_CLASS_NAME}
            >
              {renderModelRadioGroup(option.value)}
            </ComposerPickerMenuSubPopup>
          </MenuSub>
        );
      })}
      {visibleUnavailableProviderOptions.length > 0 && <MenuSeparator />}
      {visibleUnavailableProviderOptions.map((option) => {
        const OptionIcon = PROVIDER_ICON_COMPONENT_BY_PROVIDER[option.value];
        const providerLabel = resolveProviderPickerLabel(
          option.value,
          props.modelOptionsByProvider[option.value],
        );
        return (
          <MenuItem key={option.value} disabled>
            <OptionIcon
              aria-hidden="true"
              className="size-3 shrink-0 text-muted-foreground/85 opacity-80"
            />
            <span>{providerLabel}</span>
            <span className="ms-auto text-[11px] text-muted-foreground/80">Coming soon</span>
          </MenuItem>
        );
      })}
    </>
  );
};

export function ProviderModelViewer(
  props: ProviderModelMenuItemsProps & {
    onClose: () => void;
    byokCatalogGroups?: ReadonlyArray<ServerByokCatalogGroup>;
    byokProviders?: ReadonlyArray<ServerByokProviderIndexEntry>;
    byokSelectedProviderId?: string;
    onByokProviderModelChange?: (providerId: string, model: ModelSlug) => void;
  },
) {
  const { onClose } = props;
  const [query, setQuery] = useState("");
  const [providerFilter, setProviderFilter] = useState<string>(
    props.provider === "openaiCompatible" && props.byokSelectedProviderId
      ? `catalog:${props.byokSelectedProviderId}`
      : props.provider,
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const hiddenProviders = new Set(props.hiddenProviders ?? []);
  const catalogGroups = props.byokCatalogGroups ?? [];
  const byokProviderById = new Map(
    (props.byokProviders ?? []).map((provider) => [provider.id, provider]),
  );
  const visibleProviders = AVAILABLE_PROVIDER_OPTIONS.filter(
    (option) =>
      (catalogGroups.length === 0 || option.value !== "openaiCompatible") &&
      (!hiddenProviders.has(option.value) || option.value === props.provider),
  );
  const providerEntries = visibleProviders.map((option) => {
    const liveProvider = props.providers?.find((entry) => entry.provider === option.value);
    return {
      key: option.value,
      option,
      label: resolveProviderPickerLabel(
        option.value,
        props.modelOptionsByProvider[option.value],
      ),
      options: props.modelOptionsByProvider[option.value] ?? [],
      catalogProviderId: null,
      availability: liveProvider
        ? resolveLiveProviderAvailability(liveProvider)
        : { disabled: false, label: null },
    };
  });
  const catalogEntries = catalogGroups.map((group) => {
    const provider = byokProviderById.get(group.id);
    const usable =
      provider?.status === "connected" ||
      (provider?.status === "checking" && provider.apiKeyConfigured) ||
      (provider?.isLocal === true && provider.status !== "unavailable");
    const options = group.models.map((model) => ({
      slug: model.id,
      name: model.name,
      upstreamProviderId: group.id,
      upstreamProviderName: group.name,
      ...(model.toolCapable === false ? { description: "Not tool-capable" } : {}),
    }));
    return {
      key: `catalog:${group.id}`,
      catalogProviderId: group.id,
      provider: "openaiCompatible" as const,
      label: group.name,
      options,
      availability: {
        disabled: !usable,
        label: usable
          ? null
          : provider?.status === "error"
            ? "Credential error"
            : provider?.status === "checking"
              ? "Checking credentials"
              : "API key required",
      },
    };
  });
  const selectedEntry =
    catalogEntries.find(({ key }) => key === providerFilter) ??
    providerEntries.find(({ key }) => key === providerFilter);
  const selectedProviderOptions = selectedEntry?.options ?? [];
  const selectedProviderLabel = selectedEntry?.label ?? "Models";
  const selectedAvailability = selectedEntry?.availability;
  const allModelCount =
    providerEntries.reduce((count, entry) => count + entry.options.length, 0) +
    catalogEntries.reduce((count, entry) => count + entry.options.length, 0);
  const entries = [
    ...providerEntries.flatMap((entry) =>
      providerFilter !== "all" && providerFilter !== entry.key
        ? []
        : entry.options.map((option) => ({
            key: entry.key,
            catalogProviderId: null,
            provider: entry.option.value,
            label: entry.label,
            option,
            availability: entry.availability,
          })),
    ),
    ...catalogEntries.flatMap((entry) =>
      providerFilter !== "all" && providerFilter !== entry.key
        ? []
        : entry.options.map((option) => ({
            key: entry.key,
            catalogProviderId: entry.catalogProviderId,
            provider: entry.provider,
            label: entry.label,
            option,
            availability: entry.availability,
          })),
    ),
  ];
  const normalizedQuery = query.trim().toLowerCase();
  const filteredEntries = normalizedQuery.length === 0
    ? entries
    : entries.filter(({ label, option }) =>
        (buildModelSearchText(option) + " " + label).toLowerCase().includes(normalizedQuery),
      );
  const railEntries = [
    ...providerEntries.map((entry) => ({
      key: entry.key,
      label: entry.label,
      count: entry.options.length,
      availability: entry.availability,
      iconProvider: entry.option.value,
    })),
    ...catalogEntries.map((entry) => ({
      key: entry.key,
      label: entry.label,
      count: entry.options.length,
      availability: entry.availability,
      iconProvider: "openaiCompatible" as const,
    })),
  ];

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[color-mix(in_oklab,var(--popover)_94%,black)]">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-3 sm:px-6">
        <div className="min-w-0">
          <h1 className="text-sm font-semibold text-foreground">Choose a model</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">Select the model for your next turn.</p>
        </div>
        <button type="button" className="shrink-0 rounded-md border border-white/10 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 motion-reduce:transition-none" onClick={onClose}>Close</button>
      </header>
      <div className="model-picker-frame min-h-0 min-w-0 flex-1">
        <aside className="model-picker-frame-rail" aria-label="Filter models by provider">
          <div className="model-picker-frame-rail-heading">Providers</div>
          <div className="model-picker-frame-provider-list">
            <button type="button" className="model-picker-frame-provider-button" data-active={providerFilter === "all" ? "" : undefined} aria-pressed={providerFilter === "all"} onClick={() => setProviderFilter("all")}>
              <span className="model-picker-frame-provider-label"><span className="model-picker-frame-status-dot" aria-hidden="true" />All models</span>
              <span className="model-picker-frame-provider-count">{allModelCount}</span>
            </button>
            {railEntries.map(({ key, label, count, availability, iconProvider }) => {
              const ProviderIcon = PROVIDER_ICON_COMPONENT_BY_PROVIDER[iconProvider];
              return (
                <button
                  key={key}
                  type="button"
                  className="model-picker-frame-provider-button"
                  data-active={providerFilter === key ? "" : undefined}
                  aria-pressed={providerFilter === key}
                  onClick={() => setProviderFilter(key)}
                >
                  <span className="model-picker-frame-provider-label">
                    <span
                      className="model-picker-frame-status-dot"
                      data-live={availability.disabled ? undefined : ""}
                      aria-label={availability.disabled ? availability.label ?? "Unavailable" : undefined}
                    />
                    <ProviderIcon aria-hidden="true" className="model-picker-frame-provider-icon" />
                    <span className="truncate">{label}</span>
                  </span>
                  <span className="model-picker-frame-provider-count">{count}</span>
                </button>
              );
            })}
          </div>
          <button
            type="button"
            className="model-picker-frame-settings text-left hover:text-foreground"
            onClick={() => window.location.assign("/settings?section=providers")}
          >
            Provider settings ↗
          </button>
        </aside>
        <section className="model-picker-frame-main" aria-label="Available models">
          <header className="model-picker-frame-header">
            <div className="min-w-0">
              <h2 className="model-picker-frame-title">
                {providerFilter === "all" ? "Models" : selectedProviderLabel}
              </h2>
              <p className="model-picker-frame-subtitle">
                {providerFilter === "all"
                  ? "All available models"
                  : `${providerFilter.startsWith("catalog:") ? providerFilter.slice("catalog:".length) : providerFilter} · ${selectedAvailability?.disabled ? (selectedAvailability.label ?? "Unavailable").toLowerCase() : "ready"}`}
              </p>
            </div>
            <label className="model-picker-frame-search-label">
              <span className="sr-only">Search models or providers</span>
              <input
                autoFocus
                className="model-picker-frame-search"
                type="search"
                placeholder={providerFilter === "all" ? "Search models or providers" : "Search models"}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          </header>
          {providerFilter !== "all" && selectedEntry ? (
            <div className="border-b border-white/10 px-4 py-4 sm:px-6">
              <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">
                <span
                  className="model-picker-frame-status-dot"
                  data-live={selectedAvailability?.disabled ? undefined : ""}
                  aria-hidden="true"
                />
                {selectedProviderLabel} · {selectedAvailability?.disabled ? "not configured" : "configured"}
              </div>
              {selectedAvailability?.disabled ? (
                <>
                  <p className="mt-4 font-mono text-sm text-amber-400">
                    {selectedProviderLabel} has no credentials configured
                  </p>
                  <p className="mt-2 max-w-2xl text-xs leading-relaxed text-muted-foreground">
                    Configure this provider to unlock its catalog models. Models remain visible here for discovery.
                  </p>
                  <button
                    type="button"
                    className="mt-3 border border-cyan-400/60 px-3 py-1.5 font-mono text-xs text-cyan-300 transition-colors hover:bg-cyan-400/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-300"
                    onClick={() => window.location.assign("/settings?section=providers")}
                  >
                    Open provider settings ↗
                  </button>
                </>
              ) : (
                <p className="mt-3 text-xs text-muted-foreground">
                  {selectedProviderOptions.length} catalog {selectedProviderOptions.length === 1 ? "model" : "models"} available for the next turn.
                </p>
              )}
            </div>
          ) : null}
          <div className="model-picker-frame-table">
            <div className="model-picker-frame-table-header" aria-hidden="true">
              <span>{providerFilter === "all" ? "Provider / model" : "Catalog models"}</span>
              <span>{providerFilter === "all" ? "Provenance or description" : "Description"}</span>
            </div>
            <div className="model-picker-frame-scroll">
              <div className="model-picker-frame-table-body">
                {filteredEntries.length === 0 ? <div className="model-picker-frame-empty">No matching models</div> : filteredEntries.map(({ key, catalogProviderId, provider, label, option, availability }) => {
                  const isLocked = props.lockedProvider !== null && provider !== props.lockedProvider;
                  const isSelected = catalogProviderId
                    ? provider === "openaiCompatible" &&
                      props.byokSelectedProviderId === catalogProviderId &&
                      props.model === option.slug
                    : (props.lockedProvider ?? props.provider) === provider && props.model === option.slug;
                  return (
                    <button key={key + ":" + option.slug} type="button" className="model-picker-frame-model-row text-left" data-checked={isSelected ? "" : undefined} disabled={isLocked || props.disabled || availability.disabled} onClick={() => {
                      if (isLocked || props.disabled || availability.disabled) return;
                      if (catalogProviderId) {
                        props.onByokProviderModelChange?.(catalogProviderId, option.slug);
                        return;
                      }
                      const resolved = resolveSelectableModel(provider, option.slug, props.modelOptionsByProvider[provider] ?? []);
                      if (resolved) props.onProviderModelChange(provider, resolved);
                    }}>
                      <span className="model-picker-frame-model-primary"><ModelBrandIcon option={option} provider={provider} aria-hidden="true" className="model-picker-frame-model-icon" /><span className="min-w-0"><span className="model-picker-frame-model-name">{option.name}</span><span className="model-picker-frame-model-provider">{label}</span></span></span>
                      <span className="model-picker-frame-model-metadata">{buildModelMetadata(option, label, availability.label)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

// Resolves the human-readable label for the currently selected model.
export function resolveProviderModelLabel(input: {
  provider: ProviderKind;
  lockedProvider: ProviderKind | null;
  model: ModelSlug;
  modelOptionsByProvider: Record<ProviderKind, ReadonlyArray<ProviderModelOption>>;
}): string {
  const activeProvider = input.lockedProvider ?? input.provider;
  return resolveSelectedModelLabel({
    provider: activeProvider,
    model: input.model,
    options: input.modelOptionsByProvider[activeProvider],
  });
}

export function getProviderIconClassName(
  provider: ProviderKind | ProviderPickerKind,
  fallbackClassName: string = "text-muted-foreground/70",
): string {
  return providerIconClassName(provider, fallbackClassName);
}

type ProviderModelPickerProps = {
  provider: ProviderKind;
  model: ModelSlug;
  lockedProvider: ProviderKind | null;
  providers?: ReadonlyArray<ServerProviderStatus>;
  modelOptionsByProvider: Record<ProviderKind, ReadonlyArray<ProviderModelOption>>;
  loadingModelProviders?: Partial<Record<ProviderKind, boolean>>;
  hiddenProviders?: ReadonlyArray<ProviderKind>;
  providerOrder?: ReadonlyArray<ProviderKind>;
  activeProviderIconClassName?: string;
  compact?: boolean;
  // Icon-only trigger for narrow composers; the model name moves to title/sr-only.
  hideLabel?: boolean;
  disabled?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onSelectionCommitted?: () => void;
  shortcutLabel?: string | null;
  /** Prefer a single searchable model list over provider-first navigation. */
  modelSelectionMode?: "provider-first" | "model-first";
  onProviderModelChange: (provider: ProviderKind, model: ModelSlug) => void;
};

export const ProviderModelPicker = function ProviderModelPicker(props: ProviderModelPickerProps) {
  const { onOpenChange, onSelectionCommitted, open } = props;
  const [uncontrolledMenuOpen, setUncontrolledMenuOpen] = useState(false);
  const selectionCommitTimerRef = useRef<number | null>(null);
  const isMenuOpen = open ?? uncontrolledMenuOpen;
  const activeProvider = props.lockedProvider ?? props.provider;
  const selectedModelLabel = resolveProviderModelLabel({
    provider: props.provider,
    lockedProvider: props.lockedProvider,
    model: props.model,
    modelOptionsByProvider: props.modelOptionsByProvider,
  });
  const selectedModelOption =
    props.modelOptionsByProvider[activeProvider]?.find((option) => option.slug === props.model) ??
    { slug: props.model, name: selectedModelLabel };

  const setMenuOpen = (nextOpen: boolean) => {
    if (open === undefined) {
      setUncontrolledMenuOpen(nextOpen);
    }
    onOpenChange?.(nextOpen);
  };
  const scheduleSelectionCommitted = () => {
    if (selectionCommitTimerRef.current !== null) {
      window.clearTimeout(selectionCommitTimerRef.current);
    }
    // Base UI restores focus to the trigger while closing; refocus callers after that tick.
    selectionCommitTimerRef.current = window.setTimeout(() => {
      selectionCommitTimerRef.current = null;
      onSelectionCommitted?.();
    }, 0);
  };
  useEffect(
    () => () => {
      if (selectionCommitTimerRef.current !== null) {
        window.clearTimeout(selectionCommitTimerRef.current);
      }
    },
    [],
  );

  const handleAfterSelection = () => {
    setMenuOpen(false);
    scheduleSelectionCommitted();
  };

  const triggerButton = (
    <PickerTriggerButton
      disabled={props.disabled ?? false}
      compact={props.compact ?? false}
      hideLabel={props.hideLabel ?? false}
      className="text-[var(--color-text-foreground)]"
      icon={
        <ModelBrandIcon
          option={selectedModelOption}
          provider={activeProvider}
          aria-hidden="true"
          className={cn(
            // opacity-100 opts out of the Button base's [&_svg]:opacity-80 dimming.
            "size-3.5 shrink-0 opacity-100",
            providerIconClassName(activeProvider, "text-muted-foreground/70"),
            props.activeProviderIconClassName,
          )}
        />
      }
      label={selectedModelLabel}
    />
  );

  return (
    <Menu
      open={isMenuOpen}
      onOpenChange={(nextOpen) => {
        if (props.disabled) {
          setMenuOpen(false);
          return;
        }
        setMenuOpen(nextOpen);
      }}
    >
      {props.shortcutLabel ? (
        <Tooltip>
          <TooltipTrigger render={<MenuTrigger render={triggerButton} />}>
            <span className="sr-only">{selectedModelLabel}</span>
          </TooltipTrigger>
          {!isMenuOpen ? (
            <TooltipPopup side="top" sideOffset={6} variant="picker">
              <span className="inline-flex items-center gap-2 px-1 py-0.5">
                <span>Change model</span>
                <ShortcutKbd
                  shortcutLabel={props.shortcutLabel}
                  className="h-4 min-w-4 px-1 text-[length:var(--app-font-size-ui-2xs,9px)] text-muted-foreground"
                />
              </span>
            </TooltipPopup>
          ) : null}
        </Tooltip>
      ) : (
        <MenuTrigger render={triggerButton}>
          <span className="sr-only">{selectedModelLabel}</span>
        </MenuTrigger>
      )}
      <ComposerPickerMenuPopup
        align="start"
        className={props.modelSelectionMode === "model-first" ? "model-picker-frame-popup" : undefined}
        fixedWidth={props.modelSelectionMode !== "model-first"}
      >
        <ProviderModelMenuItems
          provider={props.provider}
          model={props.model}
          lockedProvider={props.lockedProvider}
          {...(props.providers ? { providers: props.providers } : {})}
          modelOptionsByProvider={props.modelOptionsByProvider}
          {...(props.loadingModelProviders
            ? { loadingModelProviders: props.loadingModelProviders }
            : {})}
          {...(props.hiddenProviders ? { hiddenProviders: props.hiddenProviders } : {})}
          {...(props.providerOrder ? { providerOrder: props.providerOrder } : {})}
          {...(props.disabled !== undefined ? { disabled: props.disabled } : {})}
          {...(props.modelSelectionMode ? { modelSelectionMode: props.modelSelectionMode } : {})}
          onProviderModelChange={props.onProviderModelChange}
          onAfterSelection={handleAfterSelection}
        />
      </ComposerPickerMenuPopup>
    </Menu>
  );
};
