import { describe, expect, it } from "vitest";

import { createTrustedChildEnvironment, resolveCredential } from "./portlog-trusted-live";

describe("trusted PortLog live launcher", () => {
  it("prefers the PortLog-specific credential alias", () => {
    expect(
      resolveCredential({
        PORTLOG_OPENROUTER_API_KEY: " portlog-secret ",
        OPENROUTER_API_KEY: "fallback-secret",
      }),
    ).toBe("portlog-secret");
  });

  it("rejects a host without a credential", () => {
    expect(() => resolveCredential({})).toThrow("must be set in the trusted host shell");
  });

  it("forwards one credential only to the trusted child", () => {
    const childEnvironment = createTrustedChildEnvironment(
      {
        PATH: "/bin",
        PORTLOG_OPENROUTER_API_KEY: "host-secret",
        OPENROUTER_API_KEY: "host-alias",
        PORTLOG_OPENAI_API_KEY: "other-secret",
        OPENAI_API_KEY: "other-alias",
      },
      "runtime-secret",
    );

    expect(childEnvironment).toEqual({
      PATH: "/bin",
      PORTLOG_OPENROUTER_API_KEY: "runtime-secret",
    });
  });
});
