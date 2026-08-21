import { describe, expect, it } from "vitest";

import { isPortLogSupportedProvider, portlogSupportedProviderIds } from "./ompProviderRegistry.ts";

describe("PortLog API provider face", () => {
  it("exposes the curated provider set without making every OMP entry first-class", () => {
    expect(portlogSupportedProviderIds()).toEqual([
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
    ]);
    expect(isPortLogSupportedProvider("openai")).toBe(true);
    expect(isPortLogSupportedProvider("openrouter")).toBe(true);
    expect(isPortLogSupportedProvider("aiand")).toBe(false);
  });
});
