import { describe, expect, it } from "vitest";

import {
  byokOAuthCommand,
  oauthExecutableMissingMessage,
  resolveByokOAuthCommand,
  supportedByokOAuthProvider,
} from "./byokOAuth.ts";

describe("BYOK OAuth commands", () => {
  it.each([
    ["openai-codex", "codex", ["login"]],
    ["cursor", "cursor-agent", ["login"]],
  ] as const)("maps %s to its native login command", (provider, executable, args) => {
    expect(byokOAuthCommand(provider, "login")).toEqual({ executable, args });
    expect(supportedByokOAuthProvider(provider)).toBe(true);
  });

  it("resolves Cursor editor overrides to the native agent command", () => {
    expect(resolveByokOAuthCommand("cursor", "login", "agent")).toEqual({
      executable: "cursor-agent",
      args: ["login"],
    });
    expect(resolveByokOAuthCommand("cursor", "logout", "cursor-agent")).toEqual({
      executable: "cursor-agent",
      args: ["logout"],
    });
  });

  it("explains missing provider executables", () => {
    expect(oauthExecutableMissingMessage("cursor", "cursor-agent")).toContain(
      "Install Cursor CLI",
    );
    expect(oauthExecutableMissingMessage("openai-codex", "codex")).toContain(
      "codex was not found",
    );
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
