import "../../index.css";

import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

const harness = vi.hoisted(() => ({
  providers: [
    { id: "openai", name: "OpenAI", isLocal: false, status: "connected", apiKeyConfigured: true },
    { id: "anthropic", name: "Anthropic", isLocal: false, status: "unavailable", apiKeyConfigured: false },
  ],
  groups: [
    {
      id: "openai",
      name: "OpenAI",
      models: [{ id: "gpt-4o", name: "GPT-4o", qualifiedId: "openai/gpt-4o" }],
    },
    {
      id: "anthropic",
      name: "Anthropic",
      models: [{ id: "claude-3-5-sonnet", name: "Claude 3.5 Sonnet", qualifiedId: "anthropic/claude-3-5-sonnet" }],
    },
  ],
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { queryKey: readonly string[] }) =>
    options.queryKey[0] === "providers"
      ? { data: { providers: harness.providers }, isLoading: false, isError: false }
      : { data: { groups: harness.groups }, isLoading: false, isError: false },
}));

vi.mock("~/lib/serverReactQuery", () => ({
  serverByokProvidersQueryOptions: () => ({ queryKey: ["providers"] }),
  serverByokCatalogGroupsQueryOptions: (query: string) => ({ queryKey: ["catalog", query] }),
}));

import { ByokModelCatalogPanel } from "./ByokModelCatalogPanel";

describe("ByokModelCatalogPanel grouped catalog", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shows qualified identities, disables unavailable providers, and emits raw model selection", async () => {
    const updateSettings = vi.fn();
    await render(
      <ByokModelCatalogPanel
        settings={{} as never}
        updateSettings={updateSettings}
      />,
    );

    expect(page.getByRole("searchbox", { name: "Search providers or models" }).element()).toBeTruthy();
    expect(document.body.textContent).toContain("openai/gpt-4o");
    expect(document.body.textContent).toContain("anthropic/claude-3-5-sonnet");
    expect(document.body.textContent).toContain("Provider unavailable");
    expect(document.body.textContent).toContain("Use model");

    const unavailable = page.getByRole("button", { name: /Claude 3\.5 Sonnet.*anthropic\/claude-3-5-sonnet/ });
    expect((unavailable.element() as HTMLButtonElement).disabled).toBe(true);

    await page.getByRole("button", { name: /GPT-4o.*openai\/gpt-4o/ }).click();
    expect(updateSettings).toHaveBeenCalledWith({
      openaiCompatibleCatalogProviderId: "openai",
      openaiCompatibleDefaultModel: "gpt-4o",
    });

    await page.getByRole("button", { name: "Configure OpenAI" }).click();
    expect(page.getByRole("textbox", { name: "OpenAI API key" }).element()).toBeTruthy();
    expect(page.getByRole("button", { name: "Save & test" }).element()).toBeTruthy();
    expect(page.getByRole("button", { name: "Test connection" }).element()).toBeTruthy();
  });
});
