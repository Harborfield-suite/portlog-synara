import {
  CheckpointRef,
  EventId,
  HarnessInvocationEvent,
  InvocationId,
  ThreadId,
  TurnId,
} from "@synara/contracts";
import { assert, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";

import { SqlitePersistenceMemory } from "./Sqlite.ts";
import { HarnessInvocationTraceRepositoryLive } from "./HarnessInvocationTrace.ts";
import { HarnessInvocationTraceRepository } from "../Services/HarnessInvocationTrace.ts";

const traceLayer = it.layer(
  Layer.mergeAll(
    HarnessInvocationTraceRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
    SqlitePersistenceMemory,
  ),
);

const threadId = ThreadId.makeUnsafe("trace-thread");
const turnId = TurnId.makeUnsafe("trace-turn");
const modelTarget = {
  kind: "model" as const,
  modelSelection: { provider: "pi" as const, model: "openai/gpt-5.5" },
  input: { prompt: "Summarize the evidence" },
};
const toolTarget = {
  kind: "tool" as const,
  toolName: "evidence.lookup",
  input: { entityId: "P-101" },
  deterministic: true,
};
const logicProgramTarget = {
  kind: "logic_program" as const,
  program: "evidence_consistency",
  input: { entityId: "P-101" },
  deterministic: true,
};

const event = (
  input: Omit<HarnessInvocationEvent, "eventId" | "invocationId" | "threadId" | "turnId"> & {
    readonly eventId?: string;
    readonly invocationId?: string;
    readonly threadId?: ThreadId;
    readonly turnId?: TurnId;
  },
): HarnessInvocationEvent => ({
  eventId: EventId.makeUnsafe(input.eventId ?? `${input.type}-${input.attempt}`),
  invocationId: InvocationId.makeUnsafe(input.invocationId ?? "invocation-default"),
  threadId: input.threadId ?? threadId,
  turnId: input.turnId ?? turnId,
  attempt: input.attempt,
  target: input.target,
  type: input.type,
  createdAt: input.createdAt,
  payload: input.payload,
});

traceLayer("HarnessInvocationTraceRepository", (it) => {
  it.effect("persists typed targets, checkpoints, attempts, and replay decisions", () =>
    Effect.gen(function* () {
      const repository = yield* HarnessInvocationTraceRepository;

      const modelStarted = event({
        eventId: "model-started",
        invocationId: "invocation-model",
        target: modelTarget,
        type: "invocation.started",
        attempt: 1,
        createdAt: "2026-08-10T06:00:00.000Z",
        payload: {},
      });
      const started = yield* repository.append(modelStarted);
      const checkpointed = yield* repository.append(
        event({
          eventId: "model-checkpoint",
          invocationId: "invocation-model",
          target: modelTarget,
          type: "invocation.checkpointed",
          attempt: 1,
          createdAt: "2026-08-10T06:00:01.000Z",
          payload: {
            checkpoint: {
              checkpointRef: CheckpointRef.makeUnsafe("checkpoint-model-1"),
              state: { contextVersion: 1 },
            },
          },
        }),
      );
      const modelCompleted = event({
        eventId: "model-completed",
        invocationId: "invocation-model",
        target: modelTarget,
        type: "invocation.completed",
        attempt: 1,
        createdAt: "2026-08-10T06:00:02.000Z",
        payload: {
          result: { text: "The evidence is consistent." },
          usage: { inputTokens: 12, outputTokens: 7 },
        },
      });
      const completed = yield* repository.append(modelCompleted);
      const duplicate = yield* repository.append(modelCompleted);

      assert.strictEqual(started.sequence, 1);
      assert.strictEqual(checkpointed.sequence, 2);
      assert.strictEqual(completed.sequence, 3);
      assert.strictEqual(duplicate.sequence, completed.sequence);

      const modelRecord = yield* repository.getById({
        invocationId: InvocationId.makeUnsafe("invocation-model"),
      });
      assert.deepStrictEqual(Option.getOrNull(modelRecord), {
        invocationId: InvocationId.makeUnsafe("invocation-model"),
        threadId,
        turnId,
        target: modelTarget,
        state: "completed",
        currentAttempt: 1,
        checkpoint: {
          checkpointRef: CheckpointRef.makeUnsafe("checkpoint-model-1"),
          state: { contextVersion: 1 },
        },
        result: { text: "The evidence is consistent." },
        error: null,
        createdAt: "2026-08-10T06:00:00.000Z",
        updatedAt: "2026-08-10T06:00:02.000Z",
        completedAt: "2026-08-10T06:00:02.000Z",
      });
      assert.deepStrictEqual(
        Option.getOrNull(
          yield* repository.getRecoveryDecision({
            invocationId: InvocationId.makeUnsafe("invocation-model"),
          }),
        ),
        {
          invocationId: InvocationId.makeUnsafe("invocation-model"),
          action: "replay",
          attempt: 1,
        },
      );

      const completedRetry = yield* Effect.flip(
        repository.append(
          event({
            eventId: "model-illegal-retry",
            invocationId: "invocation-model",
            target: modelTarget,
            type: "invocation.resumed",
            attempt: 2,
            createdAt: "2026-08-10T06:00:03.000Z",
            payload: {},
          }),
        ),
      );
      assert.strictEqual(completedRetry._tag, "PersistenceDecodeError");

      yield* repository.append(
        event({
          eventId: "tool-started",
          invocationId: "invocation-tool",
          target: toolTarget,
          type: "invocation.started",
          attempt: 1,
          createdAt: "2026-08-10T06:01:00.000Z",
          payload: {},
        }),
      );
      yield* repository.append(
        event({
          eventId: "tool-failed",
          invocationId: "invocation-tool",
          target: toolTarget,
          type: "invocation.failed",
          attempt: 1,
          createdAt: "2026-08-10T06:01:01.000Z",
          payload: {
            error: { class: "timeout", message: "lookup timed out", retryable: true },
          },
        }),
      );
      assert.deepStrictEqual(
        Option.getOrNull(
          yield* repository.getRecoveryDecision({
            invocationId: InvocationId.makeUnsafe("invocation-tool"),
          }),
        ),
        {
          invocationId: InvocationId.makeUnsafe("invocation-tool"),
          action: "retry",
          attempt: 1,
        },
      );
      yield* repository.append(
        event({
          eventId: "tool-resumed",
          invocationId: "invocation-tool",
          target: toolTarget,
          type: "invocation.resumed",
          attempt: 2,
          createdAt: "2026-08-10T06:01:02.000Z",
          payload: {},
        }),
      );
      yield* repository.append(
        event({
          eventId: "tool-completed-retry",
          invocationId: "invocation-tool",
          target: toolTarget,
          type: "invocation.completed",
          attempt: 2,
          createdAt: "2026-08-10T06:01:03.000Z",
          payload: { result: { entityId: "P-101" } },
        }),
      );
      const toolRecord = yield* repository.getById({
        invocationId: InvocationId.makeUnsafe("invocation-tool"),
      });
      assert.strictEqual(Option.getOrNull(toolRecord)?.currentAttempt, 2);
      assert.strictEqual(Option.getOrNull(toolRecord)?.state, "completed");

      yield* repository.append(
        event({
          eventId: "logic-started",
          invocationId: "invocation-logic",
          target: logicProgramTarget,
          type: "invocation.started",
          attempt: 1,
          createdAt: "2026-08-10T06:02:00.000Z",
          payload: {},
        }),
      );
      yield* repository.append(
        event({
          eventId: "logic-unknown",
          invocationId: "invocation-logic",
          target: logicProgramTarget,
          type: "invocation.unknown",
          attempt: 1,
          createdAt: "2026-08-10T06:02:01.000Z",
          payload: {
            reason: "worker disconnected after evaluation started",
            error: {
              class: "reconciliation",
              message: "External logic-program outcome is unknown",
            },
          },
        }),
      );
      const logicRecord = yield* repository.getById({
        invocationId: InvocationId.makeUnsafe("invocation-logic"),
      });
      assert.strictEqual(Option.getOrNull(logicRecord)?.state, "unknown");
      assert.strictEqual(Option.getOrNull(logicRecord)?.completedAt, null);
      assert.deepStrictEqual(
        Option.getOrNull(
          yield* repository.getRecoveryDecision({
            invocationId: InvocationId.makeUnsafe("invocation-logic"),
          }),
        ),
        {
          invocationId: InvocationId.makeUnsafe("invocation-logic"),
          action: "reconcile",
          attempt: 1,
        },
      );
      const unknownRetry = yield* Effect.flip(
        repository.append(
          event({
            eventId: "logic-illegal-retry",
            invocationId: "invocation-logic",
            target: logicProgramTarget,
            type: "invocation.resumed",
            attempt: 2,
            createdAt: "2026-08-10T06:02:02.000Z",
            payload: {},
          }),
        ),
      );
      assert.strictEqual(unknownRetry._tag, "PersistenceDecodeError");

      const events = yield* repository.readEvents({
        invocationId: InvocationId.makeUnsafe("invocation-tool"),
        limit: 10,
      });
      assert.deepStrictEqual(
        events.map((entry) => [entry.sequence, entry.event.type, entry.event.attempt]),
        [
          [4, "invocation.started", 1],
          [5, "invocation.failed", 1],
          [6, "invocation.resumed", 2],
          [7, "invocation.completed", 2],
        ],
      );
      assert.strictEqual(yield* repository.getHighWaterSequence, 9);
      assert.lengthOf(yield* repository.listByThread({ threadId }), 3);
    }),
  );

  it.effect("rejects changed content for an existing event identity", () =>
    Effect.gen(function* () {
      const repository = yield* HarnessInvocationTraceRepository;
      const first = event({
        eventId: "collision-event",
        invocationId: "invocation-collision",
        target: toolTarget,
        type: "invocation.started",
        attempt: 1,
        createdAt: "2026-08-10T06:10:00.000Z",
        payload: {},
      });
      yield* repository.append(first);
      const collision = yield* Effect.flip(
        repository.append({
          ...first,
          payload: { reason: "different content" },
        }),
      );
      assert.strictEqual(collision._tag, "PersistenceDecodeError");
    }),
  );
});
