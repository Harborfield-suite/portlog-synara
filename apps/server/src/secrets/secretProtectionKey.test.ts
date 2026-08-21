import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { SecretStoreError } from "../auth/Services/ServerSecretStore";
import { loadSecretProtectionKey, SECRET_PROTECTION_KEY_NAME } from "./secretProtectionKey.ts";

describe("secretProtectionKey", () => {
  it("uses the persisted key when the secret store succeeds", async () => {
    const key = new Uint8Array([1, 2, 3]);
    const result = await Effect.runPromise(
      loadSecretProtectionKey({
        getOrCreateRandom: (name, bytes) => {
          expect(name).toBe(SECRET_PROTECTION_KEY_NAME);
          expect(bytes).toBe(32);
          return Effect.succeed(key);
        },
      }),
    );
    expect(result).toEqual({ key, persistent: true, warning: null });
  });

  it("falls back to an ephemeral key when no secret store is available", async () => {
    const result = await Effect.runPromise(loadSecretProtectionKey());
    expect(result.key).toHaveLength(32);
    expect(result.persistent).toBe(false);
    expect(result.warning).toContain("stable across restart");
  });

  it("falls back to an ephemeral key with a warning", async () => {
    const result = await Effect.runPromise(
      loadSecretProtectionKey({
        getOrCreateRandom: () =>
          Effect.fail(new SecretStoreError({ message: "unavailable" })),
      }),
    );
    expect(result.key).toHaveLength(32);
    expect(result.persistent).toBe(false);
    expect(result.warning).toContain("stable across restart");
  });
});
