# pl-33t: OpenAI OAuth through embedded Pi

## Decision

**FEASIBLE**, with one required implementation seam: PortLog must provide a persistent, PortLog-owned `CredentialStore` for the embedded Pi runtime. The current runtime already injects an in-memory store, so it does not consume global Pi credentials, but that store does not survive runtime restart.

OpenAI Codex OAuth can be driven by the Electron-supervised Node runtime through Pi's public `ModelRuntime.login()` API and `AuthInteraction` callbacks. PortLog owns the renderer/Electron choreography and persistence; Pi owns OAuth protocol details and request-token refresh.

## Verified local API facts

- `apps/server/node_modules/@earendil-works/pi-coding-agent/dist/core/model-runtime.d.ts`
  - `ModelRuntime.create({ credentials })` accepts an injected `CredentialStore`.
  - `ModelRuntime.login(providerId, type, interaction)` performs provider login through caller-supplied interaction callbacks.
  - `ModelRuntime.logout(providerId)` removes credentials.
- `apps/server/node_modules/@earendil-works/pi-ai/dist/auth/types.d.ts`
  - `CredentialStore` exposes `read`, `list`, serialized `modify`, and `delete`.
  - `OAuthCredential` contains `access`, `refresh`, and `expires` fields.
  - `AuthInteraction` exposes `signal`, `prompt`, and `notify`.
  - `AuthEvent` includes `auth_url`, `device_code`, `progress`, and `info` events.
- `apps/portlog-runtime/src/piDriver.ts`
  - PortLog currently constructs `InMemoryCredentialStore` and passes it to `ModelRuntime.create`.
  - `modelsPath: null` prevents project/global `models.json` discovery for this runtime.
  - No `authPath` is supplied, so Pi's default global `~/.pi/agent/auth.json` is not used.
  - The OpenAI Codex model candidate is already registered as `openai-codex/gpt-5.4`.

## OAuth flow facts

Primary source: Pi implementation, [`packages/ai/src/auth/oauth/openai-codex.ts`](https://github.com/earendil-works/pi/blob/main/packages/ai/src/auth/oauth/openai-codex.ts).

- Browser login uses PKCE, state, and the fixed loopback callback `http://localhost:1455/auth/callback`.
- The flow exchanges the authorization code at `https://auth.openai.com/oauth/token`.
- The requested scope includes `offline_access`, so a refresh token is expected.
- Pi exposes a device-code alternative. It emits a device code and verification URI, then polls until the user completes authentication.
- Pi's OAuth implementation uses Node `crypto` and `http` and explicitly describes itself as CLI-only rather than browser-environment code. That is compatible with PortLog's Node runtime child, not with direct renderer execution.
- The stored credential includes the access token, refresh token, expiry, and the extracted ChatGPT account ID. The account ID is required by the credential conversion path.
- Refresh is provider-owned: Pi calls the token endpoint with the stored refresh token and converts the resulting credential to request auth.

Primary source: [Pi SDK documentation](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/sdk.md).

- SDK applications may inject a custom `ModelRuntime` into `createAgentSession`.
- The documented authentication priority is runtime overrides, stored credentials, environment variables, then fallback providers.
- The SDK documents `InMemoryCredentialStore` injection and custom credential locations; PortLog should use a custom persistent store rather than the default file path.

Primary source: [OpenAI Codex App Server documentation](https://developers.openai.com/codex/app-server).

- Codex supports ChatGPT-managed browser and device-code authentication modes.
- Host applications can own authentication lifecycle when using the external-token mode, but that is Codex app-server behavior and is not needed for the Pi OAuth path.

## Required PortLog choreography

1. Renderer model picker shows `openai-codex/gpt-5.4` as `needs_auth`.
2. User chooses **Sign in with OpenAI**.
3. Renderer sends an authenticated IPC request to the Electron main process; no token or authorization code passes through bash.
4. Runtime calls `modelRuntime.login("openai-codex", "oauth", interaction)`.
5. For the preferred Electron path, `interaction.prompt` selects `device_code` and `interaction.notify` sends the user code and verification URI to the renderer.
6. Renderer opens the verification URL in the system browser and displays the short code plus polling/cancel state.
7. Runtime receives the completed credential, persists it through the PortLog-owned credential store, and refreshes model availability.
8. Renderer receives only non-secret status (`ready`, account label if desired, expiry state); access and refresh tokens never enter renderer state, logs, bash, or transcript rows.
9. Logout calls `modelRuntime.logout("openai-codex")` through the same PortLog-owned store.
10. On runtime restart, the store reloads the encrypted credential and `ModelRuntime` refreshes access when the next request needs it.

Browser PKCE login can be offered later, but the loopback server's fixed port and callback lifecycle make device code the safer first Electron flow. If browser login is exposed, Electron must own the callback listener and enforce single-flight/state/cancellation handling.

## Storage and security requirements

- Replace `PiDriver`'s `InMemoryCredentialStore` with a PortLog implementation backed by the existing `control.sqlite` ownership boundary or the platform secure credential store. Prefer OS keychain/secure storage for token bytes; keep only non-secret metadata and provider/account linkage in SQLite.
- Implement serialized `modify` semantics. Pi refreshes inside `modify`; concurrent turns must not double-refresh or overwrite a rotated refresh token.
- Persist `type`, `access`, `refresh`, `expires`, and provider-specific `accountId` as secrets. Encrypt at rest and prevent values from entering logs, JSON-RPC responses, renderer state, bash environment, or transcript persistence.
- Do not set `authPath` to a global Pi path. Do not call Pi CLI login. Do not read `~/.pi/agent/auth.json`.
- Treat refresh-token rejection as an explicit `needs_auth` state and require a new login; do not silently fall back to an unrelated ambient credential.

## Scope boundary

This spike does not implement OAuth. The follow-up implementation bead should add the PortLog credential backend, typed IPC login/status/logout messages, device-code UI, cancellation, persistence/reload tests, and model-picker state transitions.

## Conclusion

**FEASIBLE.** Pi exposes the required provider login, interaction callbacks, injected credential store, serialized refresh writes, and model-runtime auth status. The only missing production capability is PortLog-owned persistent secret storage and the corresponding Electron/UI choreography. OpenRouter remains the current fallback while that implementation is built.
