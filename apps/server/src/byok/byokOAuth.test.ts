import { describe, expect, it } from "vitest";

import { byokOAuthCommand, supportedByokOAuthProvider } from "./byokOAuth.ts";

describe("BYOK OAuth commands", () => {
  it.each([
    ["openai-codex", "codex", ["login"]],
    ["cursor", "cursor-agent", ["login"]],
  ] as const)("maps %s to its native login command", (provider, executable, args) => {
    expect(byokOAuthCommand(provider, "login")).toEqual({ executable, args });
    expect(supportedByokOAuthProvider(provider)).toBe(true);
  });

  it("keeps logout provider-scoped and rejects unsupported providers", () => {
    expect(byokOAuthCommand("openai-codex", "logout")).toEqual({
      executable: "codex",
      args: ["logout"],
    });
    expect(byokOAuthCommand("anthropic", "login")).toBeNull();
    expect(supportedByokOAuthProvider("anthropic")).toBe(false);
  });
});
