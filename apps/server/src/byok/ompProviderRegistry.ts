/**
 * PortLog face of the Oh My Pi provider registry.
 * Source order: oh-my-pi packages/ai/src/registry/registry.ts (commit 4dc97f89).
 *
 * Coding-agent / commodity harnesses (Cursor, OpenCode, GitLab Duo, Copilot,
 * Antigravity, Gemini CLI, Devin) stay excluded from the PortLog product face.
 */

export type PortLogOmpProviderDef = {
  readonly id: string;
  readonly name: string;
  /** models.dev / BYOK catalogue id when different from `id`. */
  readonly catalogId?: string;
  readonly isLocal?: boolean;
  readonly wire?: "openai" | "anthropic" | "gemini";
  readonly baseUrl?: string;
  readonly envVar?: string;
  readonly doc?: string;
  /** Prefer OAuth login when available on the PortLog face. */
  readonly oauthPreferred?: boolean;
};

/** Explicit non-goals on the PortLog face (commodity vs core). */
export const PORTLOG_EXCLUDED_OMP_PROVIDER_IDS = [
  "cursor",
  "opencode-zen",
  "opencode-go",
  "opencode",
  "gitlab-duo",
  "gitlab-duo-agent",
  "github-copilot",
  "google-antigravity",
  "google-gemini-cli",
  "devin",
  "openai-codex-device", // same account as openai-codex; avoid duplicate row
  "kilo", // Synara harness / gateway coding agent
] as const;

/**
 * OMP registry order with PortLog exclusions removed and catalogue aliases applied.
 * Synthetic providers (no models.dev row) still appear so users can connect them.
 */
export const PORTLOG_CURATED_PROVIDER_IDS = [
  "openai",
  "anthropic",
  "google",
  "openrouter",
  "xai",
  "groq",
  "mistral",
  "deepseek",
  "together",
  "fireworks",
  "cerebras",
  "perplexity",
  "azure",
  "google-vertex",
  "ollama",
  "lm-studio",
] as const;

const PORTLOG_CURATED_PROVIDER_SET = new Set<string>(PORTLOG_CURATED_PROVIDER_IDS);

export const PORTLOG_OMP_PROVIDER_REGISTRY: ReadonlyArray<PortLogOmpProviderDef> = [
  {
    id: "azure",
    name: "Azure OpenAI",
    wire: "openai",
    baseUrl: "https://YOUR_RESOURCE.openai.azure.com/openai/v1",
    envVar: "AZURE_OPENAI_API_KEY",
    doc: "https://learn.microsoft.com/azure/ai-foundry/openai/",
  },
  {
    id: "openai-codex",
    name: "ChatGPT Plus/Pro (Codex)",
    wire: "openai",
    baseUrl: "https://api.openai.com/v1",
    envVar: "OPENAI_API_KEY",
    oauthPreferred: true,
    doc: "https://chatgpt.com/codex",
  },
  {
    id: "anthropic",
    name: "Anthropic (Claude Pro/Max)",
    wire: "anthropic",
    baseUrl: "https://api.anthropic.com",
    envVar: "ANTHROPIC_API_KEY",
    oauthPreferred: true,
    doc: "https://docs.anthropic.com",
  },
  { id: "zai", name: "Z.AI", catalogId: "zai" },
  { id: "zai-coding-plan", name: "Z.AI Coding Plan", catalogId: "zai-coding-plan" },
  { id: "kimi-code", name: "Kimi Code", catalogId: "kimi-for-coding" },
  { id: "openrouter", name: "OpenRouter" },
  {
    id: "xai",
    name: "xAI API",
    oauthPreferred: false,
  },
  {
    id: "xai-oauth",
    name: "xAI Grok OAuth (SuperGrok / X Premium+)",
    wire: "openai",
    baseUrl: "https://api.x.ai/v1",
    envVar: "XAI_API_KEY",
    oauthPreferred: true,
    doc: "https://docs.x.ai",
  },
  { id: "alibaba-coding-plan", name: "Alibaba Coding Plan" },
  { id: "alibaba-token-plan", name: "QwenCloud Token Plan" },
  { id: "aiand", name: "ai&" },
  {
    id: "aimlapi",
    name: "AIML API",
    wire: "openai",
    baseUrl: "https://api.aimlapi.com/v1",
    envVar: "AIMLAPI_KEY",
    doc: "https://aimlapi.com",
  },
  { id: "zhipu-coding-plan", name: "Zhipu Coding Plan", catalogId: "zhipuai-coding-plan" },
  { id: "umans", name: "Umans AI Coding Plan", catalogId: "umans-ai" },
  {
    id: "qwen-portal",
    name: "Qwen Portal",
    wire: "openai",
    baseUrl: "https://portal.qwen.ai/v1",
    envVar: "QWEN_API_KEY",
  },
  { id: "sakana", name: "Sakana AI" },
  { id: "minimax-code", name: "MiniMax Token Plan", catalogId: "minimax-coding-plan" },
  { id: "minimax-code-cn", name: "MiniMax Token Plan (China)", catalogId: "minimax-cn-coding-plan" },
  { id: "xiaomi", name: "Xiaomi MiMo" },
  { id: "xiaomi-token-plan-sgp", name: "Xiaomi Token Plan (Singapore)" },
  { id: "xiaomi-token-plan-ams", name: "Xiaomi Token Plan (Europe)" },
  { id: "xiaomi-token-plan-cn", name: "Xiaomi Token Plan (China)" },
  {
    id: "firepass",
    name: "Fire Pass (Fireworks)",
    wire: "openai",
    baseUrl: "https://api.fireworks.ai/inference/v1",
    envVar: "FIREWORKS_API_KEY",
  },
  { id: "deepseek", name: "DeepSeek" },
  { id: "meta", name: "Meta Model API" },
  { id: "moonshot", name: "Moonshot (Kimi API)", catalogId: "moonshotai" },
  { id: "cerebras", name: "Cerebras" },
  { id: "baseten", name: "Baseten" },
  { id: "fireworks", name: "Fireworks", catalogId: "fireworks-ai" },
  { id: "together", name: "Together", catalogId: "togetherai" },
  { id: "nvidia", name: "NVIDIA" },
  { id: "novita", name: "Novita", catalogId: "novita-ai" },
  { id: "huggingface", name: "Hugging Face Inference" },
  {
    id: "perplexity",
    name: "Perplexity",
    catalogId: "perplexity-agent",
    envVar: "PERPLEXITY_API_KEY",
  },
  {
    id: "qianfan",
    name: "Qianfan",
    wire: "openai",
    baseUrl: "https://qianfan.baidubce.com/v2",
    envVar: "QIANFAN_API_KEY",
  },
  {
    id: "venice",
    name: "Venice",
    wire: "openai",
    baseUrl: "https://api.venice.ai/api/v1",
    envVar: "VENICE_API_KEY",
  },
  { id: "siliconflow", name: "SiliconFlow" },
  { id: "siliconflow-cn", name: "SiliconFlow (China)" },
  { id: "synthetic", name: "Synthetic" },
  { id: "nanogpt", name: "NanoGPT", catalogId: "nano-gpt" },
  { id: "wafer-serverless", name: "Wafer Serverless", catalogId: "wafer.ai" },
  {
    id: "coreweave",
    name: "CoreWeave Serverless",
    wire: "openai",
    baseUrl: "https://api.coreweave.com/v1",
    envVar: "COREWEAVE_API_KEY",
  },
  {
    id: "vercel-ai-gateway",
    name: "Vercel AI Gateway",
    wire: "openai",
    baseUrl: "https://ai-gateway.vercel.sh/v1",
    envVar: "AI_GATEWAY_API_KEY",
    doc: "https://vercel.com/docs/ai-gateway",
  },
  {
    id: "cloudflare-ai-gateway",
    name: "Cloudflare AI Gateway",
    wire: "openai",
    baseUrl: "https://gateway.ai.cloudflare.com/v1",
    envVar: "CLOUDFLARE_API_TOKEN",
    doc: "https://developers.cloudflare.com/ai-gateway/",
  },
  {
    id: "litellm",
    name: "LiteLLM",
    wire: "openai",
    baseUrl: "http://127.0.0.1:4000/v1",
    envVar: "LITELLM_API_KEY",
    doc: "https://docs.litellm.ai",
  },
  { id: "zenmux", name: "ZenMux" },
  {
    id: "ollama",
    name: "Ollama (local)",
    isLocal: true,
    wire: "openai",
    baseUrl: "http://127.0.0.1:11434/v1",
    envVar: "OLLAMA_BASE_URL",
    doc: "https://docs.ollama.com",
  },
  { id: "ollama-cloud", name: "Ollama Cloud" },
  {
    id: "lm-studio",
    name: "LM Studio (local)",
    catalogId: "lmstudio",
    isLocal: true,
    wire: "openai",
    baseUrl: "http://127.0.0.1:1234/v1",
    envVar: "LM_STUDIO_API_KEY",
  },
  {
    id: "llama-cpp",
    name: "llama.cpp (local)",
    isLocal: true,
    wire: "openai",
    baseUrl: "http://127.0.0.1:8080/v1",
    envVar: "LLAMA_CPP_API_KEY",
  },
  {
    id: "vllm",
    name: "vLLM (local)",
    isLocal: true,
    wire: "openai",
    baseUrl: "http://127.0.0.1:8000/v1",
    envVar: "VLLM_API_KEY",
  },
  { id: "openai", name: "OpenAI" },
  { id: "google", name: "Google Gemini", catalogId: "google" },
  {
    id: "google-vertex",
    name: "Google Vertex AI",
    wire: "gemini",
    baseUrl: "https://aiplatform.googleapis.com",
    envVar: "GOOGLE_APPLICATION_CREDENTIALS",
  },
  { id: "groq", name: "Groq" },
  { id: "mistral", name: "Mistral" },
  { id: "minimax", name: "MiniMax" },
  {
    id: "amazon-bedrock",
    name: "Amazon Bedrock",
    wire: "openai",
    baseUrl: "https://bedrock-runtime.us-east-1.amazonaws.com",
    envVar: "AWS_ACCESS_KEY_ID",
  },
  {
    id: "bedrock-mantle",
    name: "Amazon Bedrock Mantle",
    wire: "openai",
    baseUrl: "https://bedrock-runtime.us-east-1.amazonaws.com",
    envVar: "AWS_ACCESS_KEY_ID",
  },
  { id: "gmi-cloud", name: "GMI Cloud", catalogId: "gmicloud" },
];

export function portlogOmpCatalogId(def: PortLogOmpProviderDef): string {
  return def.catalogId ?? def.id;
}

export function isExcludedOmpProvider(providerId: string): boolean {
  return (PORTLOG_EXCLUDED_OMP_PROVIDER_IDS as readonly string[]).includes(providerId);
}

export function portlogOmpProviderIds(): string[] {
  return PORTLOG_OMP_PROVIDER_REGISTRY.map((entry) => entry.id);
}

export function portlogSupportedProviderIds(): string[] {
  return [...PORTLOG_CURATED_PROVIDER_IDS];
}

export function isPortLogSupportedProvider(providerId: string): boolean {
  return PORTLOG_CURATED_PROVIDER_SET.has(providerId.trim());
}
