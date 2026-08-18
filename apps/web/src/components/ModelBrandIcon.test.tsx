import { describe, expect, it } from "vitest";
import { resolveModelBrand } from "./ModelBrandIcon";

describe("resolveModelBrand", () => {
  it("prefers a concrete upstream brand over slug and model keywords", () => {
    expect(
      resolveModelBrand({
        upstreamProviderId: "anthropic",
        slug: "openai/gpt-5",
        name: "GPT-5",
      }),
    ).toBe("anthropic");
  });

  it("uses a model namespace when OpenRouter is only the gateway", () => {
    expect(
      resolveModelBrand({
        upstreamProviderId: "OpenRouter",
        slug: "openai/gpt-5",
        name: "GPT-5",
      }),
    ).toBe("openai");
  });

  it("uses a concrete model brand before an OpenRouter namespace fallback", () => {
    expect(
      resolveModelBrand({
        upstreamProviderId: "OpenRouter",
        slug: "openrouter/auto",
        name: "Claude Sonnet",
      }),
    ).toBe("anthropic");
  });

  it("recognizes representative branded model names case-insensitively", () => {
    expect(resolveModelBrand({ slug: "provider/custom", name: "Claude Sonnet" })).toBe("anthropic");
    expect(resolveModelBrand({ slug: "google/Gemini-2.5", name: "Gemini" })).toBe("google");
    expect(resolveModelBrand({ slug: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash" })).toBe(
      "deepseek",
    );
  });

  it.each([
    ["mistral/mistral-large", "Mistral Large", "mistral"],
    ["meta/llama-4", "Llama 4", "meta"],
    ["qwen/qwen3-coder", "Qwen 3 Coder", "qwen"],
    ["groq/compound", "Compound", "groq"],
    ["ollama/llama3", "Llama 3", "ollama"],
    ["huggingface/custom", "Hugging Face model", "huggingface"],
    ["xai/grok-4", "Grok 4", "xai"],
  ])("maps %s to %s", (slug, name, expected) => {
    expect(resolveModelBrand({ slug, name })).toBe(expected);
  });

  it("returns null when no model or provider branding is known", () => {
    expect(resolveModelBrand({ slug: "internal/custom", name: "Custom Model" })).toBeNull();
  });
});
