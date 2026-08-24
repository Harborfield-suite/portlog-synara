import { describe, expect, it } from "vitest";

import { runtimeEnvironment } from "./portlogRuntimeSupervisor";

describe("runtimeEnvironment", () => {
  it("falls back to the unprefixed credential when the PortLog alias is empty", () => {
    const env = runtimeEnvironment("/tmp/portlog-runtime", {
      PATH: "/bin",
      PORTLOG_OPENROUTER_API_KEY: "",
      OPENROUTER_API_KEY: "openrouter-secret",
    });

    expect(env.PORTLOG_OPENROUTER_API_KEY).toBe("openrouter-secret");
  });
});
