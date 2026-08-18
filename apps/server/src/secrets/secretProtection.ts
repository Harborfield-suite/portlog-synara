import { createHmac } from "node:crypto";

export type SecretProtectionMode = "off" | "obfuscate" | "replace";
export type SecretInjectionChannel = "environment" | "stdin" | "file" | "provider";

export type SecretCandidate = {
  readonly name: string;
  readonly scope: string;
  readonly value: string;
  readonly source: "environment" | "secrets-file" | "credential-store";
};

export type SecretCapability = {
  readonly scope: string;
  readonly channels: ReadonlyArray<SecretInjectionChannel>;
};

export type SecretBinding = {
  readonly scope: string;
  readonly channel: SecretInjectionChannel;
  readonly target: string;
};

export type SecretAuditRecord = {
  readonly scope: string;
  readonly channel: SecretInjectionChannel | null;
  readonly outcome: "restored" | "injected" | "denied" | "replaced";
};

export type SecretProtectionResult = {
  readonly text: string;
  readonly candidates: ReadonlyArray<SecretCandidate>;
  readonly audit: ReadonlyArray<SecretAuditRecord>;
};

const PLACEHOLDER_PREFIX = "[[SYNARA_SECRET:";
const PLACEHOLDER_SUFFIX = "]]";

function placeholderFor(key: Uint8Array, candidate: SecretCandidate): string {
  const digest = createHmac("sha256", key)
    .update(`${candidate.scope}\0${candidate.name}\0${candidate.value}`)
    .digest("hex")
    .slice(0, 24);
  return `${PLACEHOLDER_PREFIX}${digest}${PLACEHOLDER_SUFFIX}`;
}

function normalizedCandidates(candidates: ReadonlyArray<SecretCandidate>): SecretCandidate[] {
  return candidates
    .filter((candidate) => candidate.name.trim() && candidate.scope.trim() && candidate.value)
    .map((candidate) => ({ ...candidate, name: candidate.name.trim(), scope: candidate.scope.trim() }))
    .toSorted((left, right) => right.value.length - left.value.length);
}

export function protectSecrets(input: {
  readonly text: string;
  readonly mode: SecretProtectionMode;
  readonly key: Uint8Array;
  readonly candidates: ReadonlyArray<SecretCandidate>;
}): SecretProtectionResult {
  const candidates = normalizedCandidates(input.candidates);
  if (input.mode === "off" || candidates.length === 0) {
    return { text: input.text, candidates: [], audit: [] };
  }

  let text = input.text;
  const audit: SecretAuditRecord[] = [];
  for (const candidate of candidates) {
    if (!text.includes(candidate.value)) continue;
    const replacement =
      input.mode === "replace" ? "[REDACTED_SECRET]" : placeholderFor(input.key, candidate);
    text = text.split(candidate.value).join(replacement);
    audit.push({
      scope: candidate.scope,
      channel: null,
      outcome: input.mode === "replace" ? "replaced" : "restored",
    });
  }
  return { text, candidates, audit };
}

export function restoreSecret(input: {
  readonly placeholder: string;
  readonly key: Uint8Array;
  readonly candidates: ReadonlyArray<SecretCandidate>;
  readonly capability: SecretCapability;
  readonly binding: SecretBinding;
}): { readonly value: string | null; readonly audit: SecretAuditRecord } {
  const candidate = normalizedCandidates(input.candidates).find(
    (entry) => placeholderFor(input.key, entry) === input.placeholder,
  );
  const allowed =
    candidate !== undefined &&
    input.capability.scope === candidate.scope &&
    input.binding.scope === candidate.scope &&
    input.capability.channels.includes(input.binding.channel);

  if (!allowed || candidate === undefined) {
    return {
      value: null,
      audit: {
        scope: candidate?.scope ?? input.binding.scope,
        channel: allowed ? input.binding.channel : null,
        outcome: "denied",
      },
    };
  }

  return {
    value: candidate.value,
    audit: {
      scope: candidate.scope,
      channel: input.binding.channel,
      outcome: "injected",
    },
  };
}

export function collectSecretCandidates(input: {
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly secretsFile: Readonly<Record<string, string>>;
  readonly credentials: ReadonlyArray<{ readonly provider: string; readonly value: string }>;
}): ReadonlyArray<SecretCandidate> {
  return [
    ...Object.entries(input.environment).flatMap(([name, value]) =>
      value
        ? [{ name, scope: `environment:${name}`, value, source: "environment" as const }]
        : [],
    ),
    ...Object.entries(input.secretsFile).map(([name, value]) => ({
      name,
      scope: `secrets-file:${name}`,
      value,
      source: "secrets-file" as const,
    })),
    ...input.credentials.map((credential) => ({
      name: credential.provider,
      scope: `provider:${credential.provider}`,
      value: credential.value,
      source: "credential-store" as const,
    })),
  ];
}
