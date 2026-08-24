# PortLog Runtime Extraction

**Status:** confirmed design; implementation not started
**Date:** 2026-08-21

## Decision

PortLog owns the product and agent definition. Pi is an embedded execution engine.
Electron owns desktop/runtime lifecycle.

The existing Synara-derived PortLog workbench is the target product frontend. Its
visual language, information architecture, interaction model, and workbench-oriented
workflows are intentional product assets and should be preserved during runtime
extraction.

The renderer is state-thin, not product-disposable: it does not own authoritative
agent/session state, credentials, Pi objects, or execution semantics, but it does own
presentation, interaction, navigation, and local UI state.

This is a backend/protocol extraction, not a frontend redesign. Do not replace or
substantially redesign the existing workbench unless a separate product decision calls
for it.

```text
Electron desktop
├── renderer
│   └── existing Synara-derived PortLog workbench
│       ├── workbench shell and navigation
│       ├── conversation/session UI
│       ├── model/provider picker
│       ├── project/artifact inspection
│       ├── evidence/findings presentation
│       ├── execution/tool activity presentation
│       ├── PortLogClient
│       └── ephemeral/local UI state
├── main process
│   └── window + runtime lifecycle only
└── apps/portlog-runtime
    ├── PortLog protocol
    ├── product control plane
    ├── workbench/project services
    ├── credential/model policy
    ├── versioned PortLog prompt
    ├── PiDriver
    └── Pi execution/session runtime
```

The important boundary is:

```text
PortLog owns CONTROL PLANE
Pi owns EXECUTION MECHANISM
```

There are three kinds of state:

```text
AUTHORITATIVE EXECUTION STATE
Pi transcript/session internals

AUTHORITATIVE PRODUCT STATE
PortLog projects, sessions, turns, findings, evidence, artifacts,
model/prompt/runtime provenance

EPHEMERAL PRESENTATION STATE
selected pane, scroll position, selected artifact, draft input,
expanded evidence, streaming deltas, local navigation
```

## Scope

All new sessions move through the PortLog runtime and Pi. Existing provider adapters
are deleted immediately; existing non-Pi sessions are disposable and do not need to
resume.

The first runtime exposes only Pi's four built-in tools:

- `read`
- `write`
- `edit`
- `bash`

No custom workspace wrappers, approval subsystem, MCP surface, browser tools, or
process-engineering tools are part of the first slice. Pi's normal tool behavior is
the capability boundary. The active project root is the tool cwd and behavioral
workspace convention; it is not an OS sandbox.

## Ownership

### PortLog owns

- Stable project and session IDs plus product metadata.
- Model selection as a product concept.
- Provider identity shown by the picker.
- Credential lookup and provider configuration.
- Versioned PortLog system prompt.
- Engineering findings, evidence, and derived artifacts.
- The runtime protocol, recovery contract, and error taxonomy.
- Workbench-facing project, artifact, evidence, and finding services.

### Pi owns

- Agent loop and turn continuation.
- Generic `read`, `write`, `edit`, and `bash` implementations.
- Agent transcript format and compaction.
- Low-level model request/response handling.
- Native model/provider extensions where Pi already supports them.

Pi does not own PortLog's ambient configuration environment. The embedded Pi runtime
is constructed explicitly by PortLog and must not implicitly consume the user's global
Pi settings, extensions, credentials, context files, session directory, or model
cache.

PortLog supplies:

- Pi session and model-cache locations;
- Pi credential storage;
- runtime settings;
- the resource loader;
- enabled tools;
- the system prompt;
- the cwd for each session.

Using Pi as a library must produce the same PortLog behavior whether or not the user
has the standalone Pi CLI installed or configured.

### Electron owns

- Launching, supervising, health-checking, restarting, and stopping the runtime.
- A narrow, typed preload bridge between renderer and runtime.
- Window lifecycle only.

The renderer never receives:

- the child-process handle;
- runtime stdin/stdout streams;
- Node filesystem primitives;
- raw Pi objects;
- unrestricted generic Electron IPC.

The preload exposes PortLog product operations, not arbitrary process operations.

## Frontend and workbench contract

The existing Synara-derived PortLog workbench is preserved as the product UI. Runtime
extraction must not be treated as permission to replace it with a generic chat
interface.

The renderer owns presentation and ephemeral interaction state, including:

- navigation and currently selected project/session/artifact;
- panel layout, expanded/collapsed state, scroll state, and draft input;
- optimistic presentation state where safe;
- artifact/viewer selection and visual workbench state.

The renderer does not own durable agent execution state or reconstruct execution
semantics independently.

All PortLog runtime communication is concentrated behind a typed `PortLogClient`
boundary. React/components must not issue raw JSON-RPC requests or depend directly on
protocol wire shapes.

```text
Workbench components
        ↓
PortLog view models / stores
        ↓
PortLogClient
        ↓
Electron preload IPC
        ↓
runtime supervisor
        ↓
PortLog protocol
```

Protocol events update renderer projections through the view-model/store layer.
Changing protocol representation must not require rewriting the visual workbench.

The migration preserves the existing workbench's major workflows, model picker,
conversation presentation, project context, artifact inspection, and execution
visibility unless explicitly superseded by a later product specification.

### Workbench states

The workbench renders explicit session/runtime states rather than inferring them from
random combinations of booleans:

```text
idle
running
cancelling
reconnecting
restoring
interrupted
provider-unavailable
authentication-required
error
```

After a stream change, the renderer does not append new-stream events onto a stale
projection. It installs the returned snapshot atomically at the snapshot barrier, then
resumes incremental application of events.

An interrupted turn remains visibly interrupted until the user explicitly sends
another turn. The UI must not present an interrupted turn as completed or silently
retry it.

### Evidence presentation

Engineering evidence is a first-class PortLog product concept. When a completed answer
contains PortLog evidence references, the workbench may render them as interactive
links into the relevant artifact/evidence view.

Raw `read` results, shell stdout, and generic tool output remain execution context and
are not automatically promoted to verified PortLog evidence. Unsupported, conflicting,
or indeterminate claims remain visibly distinct from claims bound to engineering
evidence.

## Runtime process

Create `apps/portlog-runtime` as a standalone supervised process. Do not rename or
copy the entire Synara server. Initially reuse the existing Pi adapter and event
translation code behind the new boundary; move modules only when required by the
runtime process.

The runtime initially follows the smallest module structure that preserves these
dependency boundaries:

```text
renderer/protocol → PortLog application services → PiDriver → Pi SDK
```

Pi SDK types, credential implementations, and transport wire types must not leak
across their respective boundaries. Start with a small `PiDriver` and event
translation boundary; split modules/directories as independent complexity appears.
`PiDriver` is not a pluggable multi-harness abstraction and must not recreate the
existing `AgentBackend`/provider-adapter hierarchy.

Pin the Pi package versions exactly. Record the embedded Pi version in PortLog
session metadata.

Only one runtime instance may own a given PortLog application-data directory at a
time. Startup acquires a single-writer runtime lock before opening writable session
or control-plane state. If another live runtime owns the directory, startup fails with
`RUNTIME_ALREADY_ACTIVE` rather than attempting concurrent access.

The control database uses explicit schema migrations. Migrations run before runtime
initialization succeeds. SQLite is configured for crash-safe desktop operation, and
lifecycle writes stay off the streaming hot path where practical.

### Hermetic Pi environment

The embedded runtime uses a PortLog-owned application-data layout:

```text
PortLog app data/
├── runtime/
│   ├── control.sqlite
│   └── pi/
│       ├── models-store.json
│       └── sessions/
└── credentials/
    └── OS-backed or environment-backed; never a Pi auth file
```

Pi must not discover `~/.pi/agent/auth.json`, `models.json`, settings, model caches,
extensions, global context, or standalone session files implicitly. Project
`AGENTS.md`/`CLAUDE.md` and user-installed Pi extensions are disabled as part of the
PortLog product definition unless a later explicit PortLog feature enables them.

The runtime process and agent tool environment are distinct security domains. Provider
credentials obtained by PortLog are supplied directly to Pi's model runtime through
the PortLog credential adapter and are not automatically exported into the environment
inherited by `bash` or other tools.

Agent subprocesses receive an explicitly constructed environment rather than the
runtime's complete `process.env`. Development credential environment variables are
removed from the tool environment after PortLog credential resolution.

## Runtime protocol

Electron launches the runtime as a child process. The transport is newline-delimited
JSON-RPC 2.0 over stdin/stdout, avoiding ports and a second local authentication
surface.

The channel rules are absolute:

```text
stdin  = protocol requests
stdout = protocol responses and events only
stderr = diagnostics and human-readable logs only
```

Each frame has a bounded maximum size. Malformed or oversized frames fail closed
without desynchronizing later frames.

The protocol serves two logically distinct surfaces:

1. execution/session operations used to drive Pi-backed agent work; and
2. workbench product operations used by the renderer to inspect PortLog projects,
   artifacts, evidence, and derived engineering state.

Workbench APIs are not agent tools. Exposing a bounded project read operation to the
renderer does not add a corresponding capability to the agent. The runtime is the
renderer-facing service boundary for PortLog-owned project state that previously came
from Synara server RPC.

### Initialization and compatibility

`runtime.initialize` is the first request after process launch. Electron supplies its
supported protocol range and build identity. The runtime rejects incompatible peers
before any project/session operation is accepted.

A successful initialization response reports:

```text
protocolVersion
runtimeVersion
runtimeInstanceId
piVersion
capabilities
```

No method other than `runtime.initialize` is valid before initialization succeeds.
The successful response is the readiness signal; an unsolicited `runtime.ready`
notification is not required initially.

Initial error code: `PROTOCOL_VERSION_MISMATCH`.

### First-slice methods

The first vertical slice requires:

- `runtime.initialize`
- `runtime.health`
- `runtime.shutdown`
- `project.open`
- `model.list`
- `credential.status`
- `credential.set`
- `credential.remove`
- `session.create`
- `session.attach`
- `turn.send`
- `turn.cancel`
- `session.snapshot`

Additional workbench and session operations are added as the existing UI is migrated:

- `project.describe`
- `workspace.list`
- `artifact.list`
- `artifact.describe`
- `content.read`
- `content.write`
- `session.history`
- `session.configure`
- `evidence.get`
- `finding.list`

These names express the intended PortLog product boundary but are not implementation
requirements until the corresponding workbench workflow needs them. OAuth
`credential.auth.*` operations are also deferred until a provider-auth spike
establishes the actual Pi interaction, callback, and refresh lifecycle.

All methods are bounded, typed product operations, not a generic `invoke(method, args)`
escape hatch. The renderer must not receive generic Synara RPC methods or
Pi/provider-specific methods.

`content.read` is the single byte/text retrieval primitive for the workbench. Its
`locator` is an opaque PortLog-issued value, not an arbitrary path. Locators are
validated by the runtime and use typed domains such as `workspace:...`,
`artifact:...`, or `evidence:...`; size and range limits are enforced at the runtime
boundary.

Capabilities explicitly include the current boundary:

```text
tools: [read, write, edit, bash]
filesystemSandbox: false
toolApproval: false
shellAccess: unrestricted-user-permissions
```

PortLog must not describe the project root as a sandbox or imply that these tools are
technically confined to it.

`runtime.shutdown` stops accepting turns, cancels active model work, disposes
sessions, flushes PortLog metadata, and exits successfully. Electron escalates to
SIGTERM and then SIGKILL only after bounded timeouts. `runtime.health` is a request /
response probe; process existence alone is not health.

## Project, session, and product state

`project.open` canonicalizes one project root and returns a stable `projectId`. A
project may have a different root from every other project. The runtime does not call
`process.chdir`; each Pi session receives its project's canonical root as an explicit
cwd and that binding is immutable for the session lifetime.

PortLog assigns stable product IDs. Pi session IDs and file paths are implementation
details and are never exposed as the renderer's source of identity.

PortLog uses a small durable control-plane database under its application data:

```text
projects
  id
  canonical_root
  created_at
  last_opened_at

sessions
  id
  project_id
  pi_session_locator
  created_at
  default_model_ref
  default_thinking_level
  portlog_prompt_version
  pi_version

turns
  id
  session_id
  state                # accepted | running | completed | cancelled | interrupted
  request_fingerprint  # hash only; not a second copy of prompt content
  effective_model_ref
  effective_thinking_level
  accepted_at
  started_at
  completed_at

artifacts
  id
  project_id
  kind
  locator
  sha256
  created_by_turn
  created_at

evidence
  id
  artifact_id
  locator
  claim_status         # satisfied | violated | indeterminate
  created_by_turn
  created_at

findings
  id
  project_id
  session_id
  status
  created_by_turn
  created_at
```

The artifact/evidence/finding tables are product state, not a duplicate conversation
store. Their detailed schemas can grow with the workbench. They must retain stable
locators and provenance sufficient for the UI to inspect derived engineering results.

Pi session persistence is rooted under PortLog application data, not the standalone
Pi user's default session directory:

```text
PortLog session ID → PortLog metadata → private Pi session locator
```

The control database stores product metadata and lifecycle state only. It must not
duplicate assistant messages, tool results, compaction state, or the Pi transcript.

## Events and recovery

Runtime events are PortLog events, not leaked Pi SDK events. Every event carries
`streamId` and a cursor that is monotonic only within that stream:

```text
session.started          { sessionId }
assistant.message.started   { sessionId, turnId, messageId }
assistant.message.delta     { sessionId, turnId, messageId, delta }
tool.started                { sessionId, turnId, toolCallId, toolName }
tool.completed              { sessionId, turnId, toolCallId, toolName, status,
                               preview?, contentRef?, contentBytes? }
assistant.message.completed { sessionId, turnId, messageId }
turn.completed              { sessionId, turnId }
runtime.error
session.snapshot
```

The runtime keeps a bounded per-session live-event buffer. Cursors are not durable
sequence numbers.

Reconnection works as follows:

1. The renderer attaches with `sessionId`, `streamId`, and `afterCursor`.
2. If `streamId` matches and the runtime still has the requested range, it replays
   missing events and continues.
3. If the range has expired, the runtime returns a bounded snapshot at the current
   cursor.
4. After runtime restart, a new `streamId` is created. A pre-restart cursor is never
   replayed against the new stream.
5. The renderer atomically installs the fresh snapshot at its snapshot barrier and
   continues from that barrier.

Snapshots contain the current session projection and a recent history window
sufficient to render the active workbench immediately. They are bounded by the
protocol frame and response-size limits. Older completed history is fetched lazily
through paginated `session.history`; the renderer must not require the entire Pi
transcript to become interactive.

Streaming deltas are ephemeral presentation events. The completed assistant message
and completed tool event are authoritative. The runtime may coalesce adjacent text
deltas over a short frame window before forwarding them across stdio. Tool lifecycle
events are not coalesced. Cursor ordering is defined over PortLog events after
coalescing, not raw Pi SDK events.

### Backpressure

The runtime uses bounded outbound queues. Assistant text deltas may be coalesced or
dropped when a consumer falls behind; completed messages, completed tool lifecycle
records, turn completion, and errors must not be silently dropped.

Terminal state is retained in the durable PortLog turn/session projection so that if a
client can no longer receive incremental events, the runtime can force snapshot
recovery rather than allowing unbounded memory growth. A slow consumer never expands
the queue without limit.

### Interrupted turns

A runtime restart never automatically replays or resumes an in-flight agent turn.
Generic tools may have produced external side effects before the runtime died, so
reissuing the prompt or tool call is not generally idempotent.

If the runtime terminates while a turn is active:

- the restarted runtime reconstructs the session from Pi's durable session state;
- PortLog marks the previous turn `interrupted` in its control-plane state;
- no user prompt or tool invocation is automatically reissued;
- the user may inspect the workspace and explicitly retry or continue.

"Continue the same session" means preserving conversation continuity, not replaying
partially executed work.

## Turns, identifiers, and model switching

Every session operation uses stable identifiers:

```text
projectId
sessionId
turnId
messageId
toolCallId
```

`turn.send` accepts a client-generated `turnId`. Turn acceptance is persisted before
Pi execution begins so idempotency survives runtime restart.

Repeating a `turn.send` with the same `turnId` and request fingerprint returns the
existing turn identity/state and must not create a second user turn. Reusing a
`turnId` with a different request fingerprint fails with `TURN_ID_CONFLICT`.

Only one primary turn may be active per session in the initial protocol. Concurrent
sends return `SESSION_BUSY`. `turn.cancel` is idempotent.

The model picker represents the session's default model configuration. The user may
change the model or thinking level between turns without creating a new conversation.
Each accepted turn snapshots its effective model reference and thinking level.
Changing the picker while a turn is active affects only subsequent turns.

## Errors

Synchronous JSON-RPC method failures and asynchronous runtime failures are separate.
The renderer depends on stable PortLog error codes, never provider exception strings.

Initial error taxonomy:

```text
INVALID_REQUEST
PROTOCOL_VERSION_MISMATCH
RUNTIME_ALREADY_ACTIVE
PROJECT_NOT_FOUND
SESSION_NOT_FOUND
SESSION_BUSY
TURN_ID_CONFLICT
MODEL_NOT_FOUND
CREDENTIAL_REQUIRED
PROVIDER_UNAVAILABLE
TURN_CANCELLED
TURN_INTERRUPTED
PI_RUNTIME_ERROR
RUNTIME_BACKPRESSURE
RUNTIME_FATAL
```

Error payloads contain:

```text
code
message
retryable
projectId?
sessionId?
turnId?
causeClass?
```

Provider payloads are logged to stderr or retained in runtime diagnostics as
appropriate; arbitrary provider response bodies are not passed directly to the
renderer.

## Models, credentials, and reproducibility

The existing provider/model picker remains initially. Provider labels remain visible,
but execution is represented internally as:

```text
runtime = pi
upstreamProvider = openai | openrouter | ...
model = provider-qualified Pi model reference
```

Only models resolved by Pi's model runtime are executable. Static entries that Pi
cannot resolve are not selectable. `model.list` is the sole renderer-facing source of
model capability and availability; the renderer does not maintain a parallel
executable-model catalog.

Each model entry reports, where Pi can resolve it:

```text
ref
providerId
providerLabel
modelLabel
status: ready | needs_auth | unavailable
contextWindow?
reasoning?
thinkingLevels?
modalities?
```

Models requiring credentials may remain visible but disabled with `needs_auth`.

### Credential boundary

The PortLog credential service is adapted into the credential store supplied to Pi's
`ModelRuntime`. The embedded runtime must never fall back to Pi's global
`~/.pi/agent/auth.json`.

```text
PortLog CredentialService
        │
        ├─ EnvironmentCredentialBackend  (development)
        └─ KeychainCredentialBackend      (production)
        │
        ↓
Pi CredentialStore adapter
        ↓
Pi ModelRuntime
```

The credential interface supports API-key records and OAuth records, including token
refresh data. Environment-backed development credentials are non-persistent runtime
credentials. Production storage is PortLog-controlled OS-secure storage.

### First provider priority

1. Prefer Pi's `openai-codex` ChatGPT OAuth provider if PortLog can drive its auth
   interaction through the PortLog UI and persist the resulting credential in the
   PortLog-controlled credential store. Do not silently consume `~/.pi/agent/auth.json`.
   Importing an existing standalone Pi credential, if ever supported, is an explicit
   migration operation.
2. If OpenAI OAuth is unavailable, use OpenRouter with:

```text
deepseek/deepseek-v4-flash
```

The initial smoke test uses the lowest thinking level explicitly supported by Pi's
resolved model capabilities. PortLog must not hard-code provider-specific reasoning
semantics such as `deepseek -> low`.

### Runtime manifest

Each session and turn records the product-controlled inputs that materially affect
behavior:

```text
runtimeVersion
piVersion
promptVersion
promptSha256
toolPolicyVersion
enabledPortLogSkills
modelRef
thinkingLevel
```

This reproducibility manifest records configuration identity, not transcript content.
It supports benchmark reproducibility, support diagnostics, regression detection,
finding provenance, and later A/B evaluations.

## Prompt and skills

The first PortLog system prompt is a versioned file owned by the PortLog runtime
package. Supply it through Pi's SDK `ResourceLoader` system-prompt override. Record
the prompt version and content hash in session metadata.

Reserve `before_agent_start` for dynamic PortLog-owned context that genuinely changes
between turns, such as active project or engineering context. Do not use project
`AGENTS.md`, global Pi context files, or user-installed Pi extensions as part of the
PortLog product definition. Ambient Pi resource discovery is disabled by default.

Process-engineering behavior starts as prompt/context only. Add DEXPI/topology tools
only after an evaluation demonstrates that the four generic tools are insufficient.

## Diagnostics

Runtime diagnostics are structured internally and emitted as human-readable records
to stderr. Every diagnostic carries correlation identifiers where available:

```text
runtimeInstanceId
projectId
sessionId
turnId
toolCallId
```

Known credential/token fields are redacted before diagnostics are persisted or
exported. PortLog may later expose an `Export diagnostics` workbench action containing
runtime versions, capability manifests, lifecycle logs, and sanitized failure
information, without credentials.

## First vertical slice

The first steps optimize for a visible vertical slice through the existing PortLog
workbench, not a long runtime-only implementation phase.

Use a copied DEXPI fixture in a temporary project so the source engineering artifact is
never mutated.

### Runtime conformance smoke test

Use deterministic test tasks and fixtures to verify that each exposed Pi tool can
traverse the PortLog transport correctly:

- `read`
- `write`
- `edit`
- `bash`

This test verifies integration wiring, event translation, cancellation, errors, and
tool-result transport. It is not a measure of agent quality and does not require a
particular model tool-selection strategy.

### Product capability task

Give the agent one coherent task rather than instructing it to mechanically invoke
every tool:

> Inspect this DEXPI fixture, determine the equipment and connectivity around a
> specified pump, use the existing renderer or inspection tooling if useful, and
> produce a short engineering report with evidence references. Then revise the report
> to add or correct evidence.

Acceptance flow:

1. Launch PortLog.
2. Open the copied DEXPI project root.
3. Select the existing picker model identity.
4. Prefer OpenAI OAuth; otherwise use OpenRouter DeepSeek V4 Flash.
5. Start one Pi-backed session.
6. Complete the coherent DEXPI task and follow-up revision.
7. Assert that the engineering task is completed correctly without requiring any
   particular tool-selection sequence.
8. Observe the resulting conversation, execution activity, evidence, and artifacts in
   the existing PortLog workbench.
9. Reload the renderer and verify same-stream replay using `streamId` plus cursor.
10. Restart the runtime and verify new-stream snapshot recovery.
11. Verify an interrupted turn is not automatically replayed.
12. Continue the same Pi conversation with a new user turn.
13. Verify the original DEXPI fixture hash is unchanged.

The first gate is this usable end-to-end flow, not a feature-complete headless runtime
or a complete provider matrix.

### Baseline evaluation

The generic four-tool runtime is the baseline against which future PortLog capabilities
are justified. For representative DEXPI tasks, record:

- task success and correctness;
- unsupported-claim rate;
- evidence correctness and evidence coverage;
- ability to abstain when project evidence is insufficient;
- deterministic check/result agreement where an oracle exists;
- source-artifact mutation;
- tool-call count;
- model input/output tokens;
- wall-clock latency;
- time to first useful result;
- estimated model cost;
- failures requiring manual intervention;
- number of user clarification/intervention steps;
- recovery success after renderer reload/runtime restart;
- repeated-run variance across the same task.

A PortLog-specific process-engineering capability should be added only when it
measurably improves correctness, reliability, latency, cost, or user interaction on
these tasks.

## Capability ladder

Candidate PortLog capabilities are introduced progressively and evaluated separately:

```text
Level 0  generic Pi tools
         read / write / edit / bash

Level 1  workbench-only artifact understanding
         DEXPI/P&ID preview, object navigation, artifact inspection

Level 2  context preparation
         project indexing, bounded artifact extraction, engineering context assembly

Level 3  structured engineering queries
         DEXPI equipment/topology lookup, evidence resolution

Level 4  deterministic engineering execution
         rule checks, validation, topology analysis, calculation engines
```

Levels 1 and portions of Level 2 may improve the human workbench without changing
agent tool capability and therefore need not wait for evidence that a new agent tool
is required. Levels 3-4 become agent-visible only when evaluation shows a measurable
improvement over the generic baseline.

## Migration order

The first steps optimize for a visible vertical slice through the existing PortLog
workbench, not a long runtime-only implementation phase:

1. Create the hermetic Pi embedding, explicit resource/configuration seams, sanitized
   tool environment, single-writer lock, schema migration mechanism, and exact Pi
   dependency pin.
2. Add strict NDJSON JSON-RPC framing, protocol initialization/version negotiation,
   typed errors, and the first PortLog protocol methods.
3. Prove `project.open`, `session.create`, `turn.send`, cancellation, and translated
   streamed events headlessly.
4. Have Electron supervise the runtime and expose the typed preload/client boundary.
5. Migrate the smallest existing PortLog workbench conversation path to `PortLogClient`.
   At this point a real Pi-backed turn must already work in the existing UI.
6. Add stable PortLog metadata, durable turn identity, PortLog-controlled Pi session
   storage, `streamId + cursor`, bounded snapshots/history, idempotent turn IDs, and
   interrupted-turn semantics.
7. Connect the existing workbench model picker to `model.list` and add
   environment-backed credentials through the PortLog credential interface. Verify
   OpenAI OAuth feasibility; retain OpenRouter fallback.
8. Add the minimum renderer-facing project/artifact/evidence operations required to
   preserve the existing workbench.
9. Run the copied DEXPI baseline task from the real workbench and record correctness,
   evidence quality, reliability, cost, latency, and tool metrics.
10. Replace remaining renderer assumptions on Synara RPC.
11. Delete obsolete Synara provider adapters and direct runtime paths.
12. Rename `apps/web` to `apps/portlog-ui` only after the renderer depends solely on
    the stable PortLog protocol.

## Explicit non-goals

- No new agent loop.
- No new generic file/shell tool implementation.
- No per-tool PortLog approval framework in the first slice.
- No process-engineering semantic tool suite before evaluation.
- No second transcript authority.
- No ambient use of standalone Pi global state.
- No process-wide `chdir` for project selection.
- No automatic replay of interrupted turns.
- No arbitrary generic renderer `invoke` RPC.
- No wholesale rename or copy of `apps/server`.
- No migration support for old provider sessions.
- No OS sandbox in the first slice.

A coarse project trust acknowledgement and truthful shell-access indication are
permitted and recommended because `bash` is not filesystem-sandboxed.
