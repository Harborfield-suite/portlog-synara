import { describe, expect, it } from "vitest";

import {
  buildSecretChannelPayload,
  collectSecretCandidates,
  createSecretAuditLog,
  parseSecretsFile,
  protectSecrets,
  restoreSecret,
  type SecretCandidate,
} from "./secretProtection.ts";

const key = new TextEncoder().encode("test-key");
const candidate: SecretCandidate = {
  name: "OPENAI_API_KEY",
  scope: "provider:openai",
  value: "sk-live-secret",
  source: "credential-store",
};

describe("secretProtection", () => {
  it("keeps bounded audit records without secret payloads", () => {
    const log = createSecretAuditLog(1);
    log.append({ scope: "provider:one", channel: "environment", outcome: "injected" });
    log.append({ scope: "provider:two", channel: null, outcome: "denied" });
    expect(log.records()).toEqual([{ scope: "provider:two", channel: null, outcome: "denied" }]);
  });

  it("is off by default and leaves raw text unchanged", () => {
    expect(protectSecrets({ text: candidate.value, mode: "off", key, candidates: [candidate] })).toEqual({
      text: candidate.value,
      candidates: [],
      audit: [],
    });
  });

  it("obfuscates deterministically and restores only for the declared capability/binding", () => {
    const first = protectSecrets({
      text: `run with ${candidate.value}`,
      mode: "obfuscate",
      key,
      candidates: [candidate],
    });
    const second = protectSecrets({ text: candidate.value, mode: "obfuscate", key, candidates: [candidate] });
    expect(first.text).not.toContain(candidate.value);
    expect(first.text).toContain(second.text);

    const placeholder = second.text;
    expect(
      restoreSecret({
        placeholder,
        key,
        candidates: [candidate],
        capability: { scope: candidate.scope, channels: ["environment"] },
        binding: { scope: candidate.scope, channel: "environment", target: "OPENAI_API_KEY" },
      }),
    ).toMatchObject({ value: candidate.value, audit: { outcome: "injected" } });

    expect(
      restoreSecret({
        placeholder,
        key,
        candidates: [candidate],
        capability: { scope: "provider:other", channels: ["environment"] },
        binding: { scope: candidate.scope, channel: "environment", target: "OPENAI_API_KEY" },
      }),
    ).toMatchObject({ value: null, audit: { outcome: "denied" } });
  });

  it("irreversibly replaces secrets", () => {
    const result = protectSecrets({ text: candidate.value, mode: "replace", key, candidates: [candidate] });
    expect(result.text).toBe("[REDACTED_SECRET]");
    expect(result.text).not.toContain(candidate.value);
  });

  it("binds authorized secrets to safe channels and never command arguments", () => {
    expect(
      buildSecretChannelPayload({
        value: candidate.value,
        binding: { scope: candidate.scope, channel: "environment", target: "OPENAI_API_KEY" },
      }),
    ).toEqual({
      environment: { OPENAI_API_KEY: candidate.value },
      stdin: null,
      file: null,
      provider: null,
      args: [],
    });
    expect(
      buildSecretChannelPayload({
        value: candidate.value,
        binding: { scope: candidate.scope, channel: "stdin", target: "credential" },
      }).args,
    ).toEqual([]);
  });

  it("parses flat secrets.yml values without returning comments", () => {
    expect(parseSecretsFile("TOKEN: file-secret\nquoted: \"quoted-secret\"\n# nope\n")).toEqual({
      TOKEN: "file-secret",
      quoted: "quoted-secret",
    });
  });

  it("collects environment, secrets-file, and credential-store sources", () => {
    expect(
      collectSecretCandidates({
        environment: { A_TOKEN: "env-secret", EMPTY: undefined },
        secretsFile: { registry: "file-secret" },
        credentials: [{ provider: "openai", value: "stored-secret" }],
      }).map((entry) => entry.source),
    ).toEqual(["environment", "secrets-file", "credential-store"]);
  });
});
