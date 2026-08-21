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
    ["anthropic", "claude", []],
    ["cursor", "cursor-agent", ["login"]],
    ["google-antigravity", "agy", []],
    ["xai-oauth", "grok", ["login", "--oauth"]],
    ["droid", "droid", []],
    ["kilo", "kilo", ["auth", "login"]],
    ["opencode", "opencode", ["auth", "login"]],
  ] as const)("maps %s to its native login command", (provider, executable, args) => {
    expect(byokOAuthCommand(provider, "login")).toMatchObject({ executable, args });
    expect(supportedByokOAuthProvider(provider)).toBe(true);
  });

  it("preserves background login for interactive provider-owned flows", () => {
    expect(resolveByokOAuthCommand("anthropic", "login")).toEqual({
      executable: "claude",
      args: [],
      background: true,
    });
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
    expect(byokOAuthCommand("anthropic", "logout")).toBeNull();
    expect(byokOAuthCommand("pi", "login")).toBeNull();
    expect(supportedByokOAuthProvider("pi")).toBe(false);
  });
});
