import { describe, expect, it } from "vitest";

import {
  collectSecretCandidates,
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
