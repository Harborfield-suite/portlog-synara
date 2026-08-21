import { describe, expect, it } from "vitest";

import {
  getRememberedByokProbe,
  rememberByokProbe,
  resetByokProbeCacheForTests,
} from "./byokConnectionRegistry.ts";

describe("BYOK probe health", () => {
  it("keeps definitive health across transient network failures", () => {
    resetByokProbeCacheForTests();

    rememberByokProbe("openrouter", { kind: "ok" });
    rememberByokProbe("openrouter", { kind: "network" });

    expect(getRememberedByokProbe("openrouter")).toEqual({ kind: "ok" });
  });

  it("records definitive invalidation", () => {
    resetByokProbeCacheForTests();

    rememberByokProbe("openrouter", { kind: "ok" });
    rememberByokProbe("openrouter", { kind: "invalid-credential" });

    expect(getRememberedByokProbe("openrouter")).toEqual({ kind: "invalid-credential" });
  });
});
