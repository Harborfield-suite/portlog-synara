import { describe, expect, it, vi } from "vitest";

import { testByokConnection } from "./testByokConnection.ts";

describe("testByokConnection", () => {
  it("returns ok when the models endpoint accepts the key", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const result = await testByokConnection({
      providerId: "openrouter",
      apiKey: "sk-good",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toEqual({ kind: "ok" });
    expect(fetchImpl).toHaveBeenCalled();
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toContain("/models");
    expect((init as RequestInit).headers).toMatchObject({
      authorization: "Bearer sk-good",
    });
  });

  it("returns invalid-credential on 401", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 401 }));
    await expect(
      testByokConnection({
        providerId: "openrouter",
        apiKey: "sk-bad",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).resolves.toEqual({ kind: "invalid-credential" });
  });

  it("classifies provider 5xx responses as transient network failures", async () => {
    const fetchImpl = vi.fn(async () => new Response("busy", { status: 503 }));

    await expect(
      testByokConnection({
        providerId: "openrouter",
        apiKey: "sk-good",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).resolves.toEqual({ kind: "network" });
  });

  it("returns endpoint-offline when a local provider cannot be reached", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    await expect(
      testByokConnection({
        providerId: "ollama",
        apiKey: null,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).resolves.toEqual({ kind: "endpoint-offline" });
  });
});
