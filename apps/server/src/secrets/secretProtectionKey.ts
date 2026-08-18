import { randomBytes } from "node:crypto";
import { Effect } from "effect";

import type { ServerSecretStoreShape } from "../auth/Services/ServerSecretStore";

export const SECRET_PROTECTION_KEY_NAME = "secret-protection-hmac-key";

export type SecretProtectionKeyResolution = {
  readonly key: Uint8Array;
  readonly persistent: boolean;
  readonly warning: string | null;
};

export function loadSecretProtectionKey(
  store: Pick<ServerSecretStoreShape, "getOrCreateRandom">,
): Effect.Effect<SecretProtectionKeyResolution, never> {
  return store.getOrCreateRandom(SECRET_PROTECTION_KEY_NAME, 32).pipe(
    Effect.map((key) => ({ key, persistent: true, warning: null })),
    Effect.catch(() =>
      Effect.succeed({
        key: randomBytes(32),
        persistent: false,
        warning: "Secret placeholders will not remain stable across restart.",
      }),
    ),
  );
}
