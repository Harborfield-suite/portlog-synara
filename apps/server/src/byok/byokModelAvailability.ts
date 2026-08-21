/**
 * User-visible model availability states derived from already-resolved facts.
 *
 * This module does not inspect credentials, probe endpoints, or load adapters.
 * Callers own those concerns and pass their boolean readiness facts here.
 */
export type ByokModelAvailabilityState = "available" | "needs-setup" | "retired";

export type ByokModelAvailabilityFacts = {
  /** Whether credential/auth configuration is ready for use. */
  readonly credentialReady: boolean;
  /** Whether the model endpoint configuration is ready for use. */
  readonly endpointReady: boolean;
  /** Whether the provider adapter needed to invoke the model is ready. */
  readonly adapterReady: boolean;
  /** Whether the model is retired from the current catalog. */
  readonly retired: boolean;
};

export type ByokModelAvailability = {
  readonly state: ByokModelAvailabilityState;
  readonly reason: string;
};

const RETIRED_REASON = "Retired model; unavailable for use.";
const AVAILABLE_REASON = "All model availability prerequisites are ready.";

const MISSING_PREREQUISITES = [
  ["credential/auth readiness", "configure credential/auth"],
  ["endpoint readiness", "configure the endpoint"],
  ["adapter readiness", "configure the provider adapter"],
] as const;

/**
 * Resolve user-visible usability from static readiness facts.
 *
 * Retired status takes precedence over every readiness fact. Reasons are
 * deterministic and intentionally contain no credential or provider values.
 */
export function resolveByokModelAvailability(
  facts: ByokModelAvailabilityFacts,
): ByokModelAvailability {
  if (facts.retired) {
    return { state: "retired", reason: RETIRED_REASON };
  }

  const missing = MISSING_PREREQUISITES.filter(([, _action], index) => {
    const ready = [facts.credentialReady, facts.endpointReady, facts.adapterReady][index];
    return !ready;
  });

  if (missing.length === 0) {
    return { state: "available", reason: AVAILABLE_REASON };
  }

  return {
    state: "needs-setup",
    reason: `Setup required: ${missing.map(([, action]) => `${action};`).join(" ")}`,
  };
}
