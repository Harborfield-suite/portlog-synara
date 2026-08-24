# PortLog product-path proof

Date: 2026-08-24
Fixture: `ha-c01-centrifugal-pumps-retrieval`

## Results

- `bun run portlog:trusted-live proof`: passed. Project open, model catalog, session create/attach, artifact inspection, content read/write, evidence, findings, runtime restart recovery, interrupted-turn recovery, and cancellation all passed.
- `bun run portlog:trusted-live smoke`: passed with the trusted OpenRouter credential. OpenRouter model readiness, assistant streaming, `read` tool lifecycle, and completed turn with the fixture sentinel all passed.
- `bun run portlog:trusted-live baseline --fixture-dir <fixture>`: passed 3/3 runs. All runs were source-unchanged, had full witness coverage, zero unsupported claims, and zero user interventions.
- `bun run test:desktop-smoke`: passed. Packaged Electron launch completed without fatal startup errors.
- `bun run --cwd apps/portlog-runtime test`: 18/18 passed.
- `bun run --cwd scripts test -- portlog-trusted-live.test.ts`: 3/3 passed.
- `bun run --cwd apps/web test src/portlog`: 30/30 passed.
- `bun run --cwd apps/web test:browser src/portlog`: 2/2 passed.
- Covered PortLog coupling audit found no `NativeApi`, `readNativeApi`, `ensureNativeApi`, `@synara/server`, or `apps/server` references.

Renderer reload recovery is implemented in `PortLogRuntimeChatPanel`: stored sessions attach on mount, snapshots install before pending events, and `streamId`/`cursor` filter replay. Runtime restart and interrupted-turn recovery are exercised by the product proof above.

The run uses the explicit OpenRouter fallback documented for PortLog; no Synara server or legacy provider path is started.
