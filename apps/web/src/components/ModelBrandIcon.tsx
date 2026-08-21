import type { ProviderKind } from "@synara/contracts";
import type { SVGProps } from "react";
import {
  SiGooglegemini,
  SiHuggingface,
  SiMeta,
  SiMistralai,
  SiOllama,
} from "react-icons/si";
import { ClaudeAI, GrokIcon, OpenAI, type Icon } from "./Icons";
import { PROVIDER_ICON_COMPONENT_BY_PROVIDER } from "./ProviderIcon";
import type { ProviderModelOption } from "../providerModelOptions";

export type ModelBrand =
  | "anthropic"
  | "openai"
  | "google"
  | "xai"
  | "deepseek"
  | "mistral"
  | "meta"
  | "qwen"
  | "groq"
  | "ollama"
  | "huggingface"
  | "openrouter";

type BrandRule = { brand: ModelBrand; keywords: readonly string[] };
type ModelBrandOption = Pick<ProviderModelOption, "name" | "slug" | "upstreamProviderId">;

const BRAND_RULES: readonly BrandRule[] = [
  { brand: "anthropic", keywords: ["anthropic", "claude"] },
  { brand: "openai", keywords: ["openai", "gpt", "o-series", "o1", "o3", "o4", "o5", "codex"] },
  { brand: "google", keywords: ["google", "gemini"] },
  { brand: "xai", keywords: ["xai", "grok"] },
  { brand: "deepseek", keywords: ["deepseek"] },
  { brand: "mistral", keywords: ["mistral"] },
  { brand: "ollama", keywords: ["ollama"] },
  { brand: "meta", keywords: ["meta", "llama"] },
  { brand: "qwen", keywords: ["qwen"] },
  { brand: "groq", keywords: ["groq"] },
  { brand: "huggingface", keywords: ["huggingface", "hugging-face"] },
];

function findBrand(value: string | undefined): ModelBrand | null {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (!normalized) return null;
  for (const rule of BRAND_RULES) {
    if (rule.keywords.some((keyword) => normalized.includes(keyword))) return rule.brand;
  }
  return normalized.includes("openrouter") ? "openrouter" : null;
}

/** Resolves model branding without consulting provider catalogs or runtime state. */
export function resolveModelBrand(option: ModelBrandOption): ModelBrand | null {
  const upstreamBrand = findBrand(option.upstreamProviderId);
  if (upstreamBrand && upstreamBrand !== "openrouter") return upstreamBrand;

  const namespaceBrand = findBrand(option.slug.split("/", 1)[0]);
  if (namespaceBrand && namespaceBrand !== "openrouter") return namespaceBrand;

  const modelBrand = findBrand(`${option.name} ${option.slug}`);
  return modelBrand ?? namespaceBrand ?? upstreamBrand;
}

function createBrandMonogramIcon(label: string): Icon {
  return function BrandMonogramIcon(props) {
    return (
      <svg {...props} viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="7" fill="currentColor" opacity="0.16" />
        <text
          x="8"
          y="10.5"
          fill="currentColor"
          fontFamily="ui-sans-serif, system-ui, sans-serif"
          fontSize={label.length > 1 ? "5.2" : "7"}
          fontWeight="700"
          textAnchor="middle"
        >
          {label}
        </text>
      </svg>
    );
  };
}

const ICON_BY_BRAND: Record<ModelBrand, Icon> = {
  anthropic: ClaudeAI,
  openai: OpenAI,
  google: (props) => <SiGooglegemini {...props} />,
  xai: GrokIcon,
  deepseek: createBrandMonogramIcon("D"),
  mistral: (props) => <SiMistralai {...props} />,
  meta: (props) => <SiMeta {...props} />,
  qwen: createBrandMonogramIcon("Q"),
  groq: createBrandMonogramIcon("G"),
  ollama: (props) => <SiOllama {...props} />,
  huggingface: (props) => <SiHuggingface {...props} />,
  openrouter: createBrandMonogramIcon("OR"),
};

export function ModelBrandIcon({
  option,
  provider,
  ...props
}: {
  option: ModelBrandOption;
  provider: ProviderKind;
} & SVGProps<SVGSVGElement>) {
  const brand = resolveModelBrand(option);
  if (brand) {
    const Icon = ICON_BY_BRAND[brand];
    return <Icon {...props} aria-hidden={props["aria-hidden"] ?? true} />;
  }

  const ProviderIcon = PROVIDER_ICON_COMPONENT_BY_PROVIDER[provider];
  return ProviderIcon ? <ProviderIcon {...props} /> : <span aria-hidden="true">•</span>;
}
