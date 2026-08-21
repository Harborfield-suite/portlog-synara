import { describe, expect, it } from "vitest";

import {
  resolveByokModelAvailability,
  type ByokModelAvailabilityFacts,
} from "./byokModelAvailability.ts";

const readyFacts: ByokModelAvailabilityFacts = {
  credentialReady: true,
  endpointReady: true,
  adapterReady: true,
  retired: false,
};

describe("resolveByokModelAvailability", () => {
  it("returns available when every prerequisite is ready", () => {
    expect(resolveByokModelAvailability(readyFacts)).toEqual({
      state: "available",
      reason: "All model availability prerequisites are ready.",
    });
  });

  it.each([
    ["credential/auth", { credentialReady: false }],
    ["endpoint", { endpointReady: false }],
    ["adapter", { adapterReady: false }],
  ] as const)("returns needs-setup when %s readiness is missing", (_name, override) => {
    const result = resolveByokModelAvailability({ ...readyFacts, ...override });

    expect(result.state).toBe("needs-setup");
    expect(result.reason).toMatch(/^Setup required:/);
    expect(result.reason).toContain(_name);
  });

  it("reports multiple missing prerequisites in credential, endpoint, adapter order", () => {
    expect(
      resolveByokModelAvailability({
        ...readyFacts,
        credentialReady: false,
        endpointReady: false,
        adapterReady: false,
      }),
    ).toEqual({
      state: "needs-setup",
      reason:
        "Setup required: configure credential/auth; configure the endpoint; configure the provider adapter;",
    });
  });

  it("returns retired before considering readiness", () => {
    expect(
      resolveByokModelAvailability({
        credentialReady: true,
        endpointReady: true,
        adapterReady: true,
        retired: true,
      }),
    ).toEqual({
      state: "retired",
      reason: "Retired model; unavailable for use.",
    });
  });

  it("always returns the stable state-and-reason result shape", () => {
    const result = resolveByokModelAvailability(readyFacts);

    expect(Object.keys(result)).toEqual(["state", "reason"]);
    expect(typeof result.state).toBe("string");
    expect(typeof result.reason).toBe("string");
  });
});
