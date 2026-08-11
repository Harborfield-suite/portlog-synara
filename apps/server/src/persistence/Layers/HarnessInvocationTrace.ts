import {
  HarnessInvocationCheckpoint,
  HarnessInvocationError,
  HarnessInvocationEvent,
  HarnessInvocationRecord,
  HarnessInvocationRecoveryDecision,
  HarnessInvocationState,
  HarnessInvocationTarget,
  InvocationId,
  IsoDateTime,
  NonNegativeInt,
  ThreadId,
} from "@synara/contracts";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { Effect, Layer, Option, Schema } from "effect";

import {
  PersistenceDecodeError,
  toPersistenceDecodeError,
  toPersistenceSqlError,
} from "../Errors.ts";
import {
  HarnessInvocationTraceRepository,
  type HarnessInvocationTraceRepositoryShape,
  PersistedHarnessInvocationEvent,
} from "../Services/HarnessInvocationTrace.ts";

const HarnessInvocationEventJson = Schema.fromJsonString(HarnessInvocationEvent);
const HarnessInvocationTargetJson = Schema.fromJsonString(HarnessInvocationTarget);
const HarnessInvocationCheckpointJson = Schema.fromJsonString(HarnessInvocationCheckpoint);
const HarnessInvocationErrorJson = Schema.fromJsonString(HarnessInvocationError);
const UnknownJson = Schema.fromJsonString(Schema.Unknown);

const decodeEvent = Schema.decodeUnknownEffect(HarnessInvocationEventJson);
const decodeRecord = Schema.decodeUnknownEffect(HarnessInvocationRecord);

const RawInvocationRowSchema = Schema.Struct({
  invocationId: InvocationId,
  threadId: ThreadId,
  turnId: Schema.String,
  target: HarnessInvocationTargetJson,
  state: HarnessInvocationState,
  currentAttempt: Schema.Int,
  checkpoint: Schema.NullOr(HarnessInvocationCheckpointJson),
  result: Schema.NullOr(UnknownJson),
  error: Schema.NullOr(HarnessInvocationErrorJson),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  completedAt: Schema.NullOr(IsoDateTime),
});

const RawEventRowSchema = Schema.Struct({
  sequence: NonNegativeInt,
  eventJson: Schema.String,
});

const decodeRawInvocationRow = Schema.decodeUnknownEffect(RawInvocationRowSchema);
const decodeRawEventRow = Schema.decodeUnknownEffect(RawEventRowSchema);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const canonicalJsonValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalJsonValue(nested)]),
  );
};

const canonicalJson = (value: unknown): string => {
  const encoded = JSON.stringify(canonicalJsonValue(value));
  if (encoded === undefined) {
    throw new Error("Invocation trace values must be JSON serializable.");
  }
  return encoded;
};

const eventTypeState = (
  event: HarnessInvocationEvent,
  currentState: HarnessInvocationState | null,
): HarnessInvocationState => {
  switch (event.type) {
    case "invocation.started":
    case "invocation.resumed":
      return "running";
    case "invocation.completed":
      return "completed";
    case "invocation.failed":
      return "failed";
    case "invocation.unknown":
      return "unknown";
    case "invocation.interrupted":
      return "interrupted";
    case "invocation.cancelled":
      return "cancelled";
    case "invocation.checkpointed":
      return currentState ?? "running";
  }
};

const isRetryEligibleState = (state: HarnessInvocationState): boolean =>
  state === "failed" || state === "interrupted" || state === "cancelled";

const makeInvariantError = (operation: string, issue: string) =>
  new PersistenceDecodeError({ operation, issue });

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const readInvocationRows = (input: {
    readonly invocationId?: InvocationId;
    readonly threadId?: ThreadId;
  }) =>
    input.invocationId !== undefined
      ? sql<Record<string, unknown>>`
          SELECT
            invocation_id AS "invocationId",
            thread_id AS "threadId",
            turn_id AS "turnId",
            target_json AS "target",
            state,
            current_attempt AS "currentAttempt",
            checkpoint_json AS "checkpoint",
            result_json AS "result",
            error_json AS "error",
            created_at AS "createdAt",
            updated_at AS "updatedAt",
            completed_at AS "completedAt"
          FROM harness_invocations
          WHERE invocation_id = ${input.invocationId}
        `
      : sql<Record<string, unknown>>`
          SELECT
            invocation_id AS "invocationId",
            thread_id AS "threadId",
            turn_id AS "turnId",
            target_json AS "target",
            state,
            current_attempt AS "currentAttempt",
            checkpoint_json AS "checkpoint",
            result_json AS "result",
            error_json AS "error",
            created_at AS "createdAt",
            updated_at AS "updatedAt",
            completed_at AS "completedAt"
          FROM harness_invocations
          WHERE thread_id = ${input.threadId}
          ORDER BY created_at ASC, invocation_id ASC
        `;

  const decodeInvocationRows = (rows: ReadonlyArray<unknown>, operation: string) =>
    Effect.forEach(rows, (row) =>
      decodeRawInvocationRow(row).pipe(
        Effect.mapError(toPersistenceDecodeError(operation)),
        Effect.flatMap((decoded) =>
          decodeRecord(decoded).pipe(Effect.mapError(toPersistenceDecodeError(operation))),
        ),
      ),
    );

  const append: HarnessInvocationTraceRepositoryShape["append"] = (event) =>
    Effect.gen(function* () {
      const eventJson = yield* Effect.try({
        try: () => canonicalJson(event),
        catch: (cause) =>
          new PersistenceDecodeError({
            operation: "HarnessInvocationTrace.append.encode",
            issue: "Invocation event is not JSON serializable.",
            cause,
          }),
      });
      yield* Schema.decodeUnknownEffect(HarnessInvocationEvent)(event).pipe(
        Effect.mapError(toPersistenceDecodeError("HarnessInvocationTrace.append.validate")),
      );

      const persisted = yield* sql
        .withTransaction(
          Effect.gen(function* () {
            const duplicateRows = yield* sql<Record<string, unknown>>`
            SELECT sequence, event_json AS "eventJson"
            FROM harness_invocation_events
            WHERE event_id = ${event.eventId}
          `;
            if (duplicateRows.length > 0) {
              const duplicate = yield* decodeRawEventRow(duplicateRows[0]).pipe(
                Effect.mapError(
                  toPersistenceDecodeError("HarnessInvocationTrace.append.duplicate"),
                ),
              );
              if (duplicate.eventJson !== eventJson) {
                return yield* makeInvariantError(
                  "HarnessInvocationTrace.append",
                  `Invocation event '${event.eventId}' was reused with different content.`,
                );
              }
              const decoded = yield* decodeEvent(duplicate.eventJson).pipe(
                Effect.mapError(
                  toPersistenceDecodeError("HarnessInvocationTrace.append.duplicate"),
                ),
              );
              return {
                sequence: duplicate.sequence,
                event: decoded,
              } satisfies PersistedHarnessInvocationEvent;
            }

            const invocationRows = yield* sql<{
              readonly invocationId: string;
              readonly threadId: string;
              readonly turnId: string;
              readonly targetJson: string;
              readonly state: HarnessInvocationState;
              readonly currentAttempt: number;
              readonly checkpointJson: string | null;
              readonly resultJson: string | null;
              readonly errorJson: string | null;
              readonly createdAt: string;
              readonly completedAt: string | null;
            }>`
            SELECT
              invocation_id AS "invocationId",
              thread_id AS "threadId",
              turn_id AS "turnId",
              target_json AS "targetJson",
              state,
              current_attempt AS "currentAttempt",
              checkpoint_json AS "checkpointJson",
              result_json AS "resultJson",
              error_json AS "errorJson",
              created_at AS "createdAt",
              completed_at AS "completedAt"
            FROM harness_invocations
            WHERE invocation_id = ${event.invocationId}
          `;
            const existing = invocationRows[0];
            const targetJson = canonicalJson(event.target);
            let nextState: HarnessInvocationState;
            let nextAttempt = event.attempt;
            let checkpointJson: string | null = null;
            let resultJson: string | null = null;
            let errorJson: string | null = null;
            let createdAt = event.createdAt;
            let completedAt: string | null = null;

            if (existing === undefined) {
              if (event.type !== "invocation.started" || event.attempt !== 1) {
                return yield* makeInvariantError(
                  "HarnessInvocationTrace.append",
                  "A new invocation must begin with invocation.started at attempt 1.",
                );
              }
              nextState = "running";
            } else {
              if (existing.threadId !== event.threadId || existing.turnId !== event.turnId) {
                return yield* makeInvariantError(
                  "HarnessInvocationTrace.append",
                  `Invocation '${event.invocationId}' changed its turn identity.`,
                );
              }
              let storedTarget: unknown;
              try {
                storedTarget = JSON.parse(existing.targetJson);
              } catch (cause) {
                return yield* makeInvariantError(
                  "HarnessInvocationTrace.append",
                  `Invocation '${event.invocationId}' has corrupt target metadata: ${String(cause)}.`,
                );
              }
              if (canonicalJson(storedTarget) !== targetJson) {
                return yield* makeInvariantError(
                  "HarnessInvocationTrace.append",
                  `Invocation '${event.invocationId}' changed its target metadata.`,
                );
              }
              if (event.attempt < existing.currentAttempt) {
                return yield* makeInvariantError(
                  "HarnessInvocationTrace.append",
                  `Invocation '${event.invocationId}' appended an older attempt.`,
                );
              }
              if (existing.state === "completed") {
                return yield* makeInvariantError(
                  "HarnessInvocationTrace.append",
                  `Completed invocation '${event.invocationId}' cannot be executed again.`,
                );
              }
              if (event.attempt > existing.currentAttempt) {
                if (
                  event.type !== "invocation.resumed" ||
                  event.attempt !== existing.currentAttempt + 1 ||
                  !isRetryEligibleState(existing.state)
                ) {
                  return yield* makeInvariantError(
                    "HarnessInvocationTrace.append",
                    `Invocation '${event.invocationId}' cannot advance from attempt ${existing.currentAttempt} while ${existing.state}.`,
                  );
                }
              } else if (event.type === "invocation.resumed") {
                return yield* makeInvariantError(
                  "HarnessInvocationTrace.append",
                  `Invocation '${event.invocationId}' resumed without advancing its attempt.`,
                );
              }
              nextState = eventTypeState(event, existing.state);
              nextAttempt = event.attempt;
              checkpointJson = existing.checkpointJson;
              resultJson = existing.resultJson;
              errorJson = existing.errorJson;
              createdAt = existing.createdAt;
              completedAt = existing.completedAt;
            }

            if (
              event.type === "invocation.checkpointed" &&
              event.payload.checkpoint !== undefined
            ) {
              checkpointJson = canonicalJson(event.payload.checkpoint);
            }
            if (event.type === "invocation.completed") {
              resultJson = canonicalJson(event.payload.result ?? null);
              errorJson = null;
              completedAt = event.createdAt;
            }
            if (event.type === "invocation.failed") {
              errorJson =
                event.payload.error === undefined ? null : canonicalJson(event.payload.error);
              completedAt = event.createdAt;
            }
            if (event.type === "invocation.unknown") {
              errorJson =
                event.payload.error === undefined ? errorJson : canonicalJson(event.payload.error);
              // Unknown is deliberately not a completed timestamp: reconciliation
              // must still establish the external outcome before retrying.
              completedAt = null;
            }
            if (event.type === "invocation.interrupted" || event.type === "invocation.cancelled") {
              completedAt = event.createdAt;
            }
            if (event.type === "invocation.resumed") {
              completedAt = null;
              errorJson = null;
            }

            if (existing === undefined) {
              yield* sql`
              INSERT INTO harness_invocations (
                invocation_id,
                thread_id,
                turn_id,
                target_kind,
                target_json,
                state,
                current_attempt,
                checkpoint_json,
                result_json,
                error_json,
                created_at,
                updated_at,
                completed_at
              ) VALUES (
                ${event.invocationId},
                ${event.threadId},
                ${event.turnId},
                ${event.target.kind},
                ${targetJson},
                ${nextState},
                ${nextAttempt},
                ${checkpointJson},
                ${resultJson},
                ${errorJson},
                ${createdAt},
                ${event.createdAt},
                ${completedAt}
              )
            `;
            }

            const eventRows = yield* sql<{ readonly sequence: number }>`
            INSERT INTO harness_invocation_events (
              event_id,
              invocation_id,
              thread_id,
              turn_id,
              attempt,
              event_type,
              event_json,
              created_at
            ) VALUES (
              ${event.eventId},
              ${event.invocationId},
              ${event.threadId},
              ${event.turnId},
              ${event.attempt},
              ${event.type},
              ${eventJson},
              ${event.createdAt}
            )
            RETURNING sequence
          `;
            const sequence = eventRows[0]?.sequence;
            if (sequence === undefined) {
              return yield* makeInvariantError(
                "HarnessInvocationTrace.append",
                `Invocation event '${event.eventId}' was not assigned a sequence.`,
              );
            }

            if (existing !== undefined) {
              yield* sql`
              UPDATE harness_invocations
              SET
                state = ${nextState},
                current_attempt = ${nextAttempt},
                checkpoint_json = ${checkpointJson},
                result_json = ${resultJson},
                error_json = ${errorJson},
                updated_at = ${event.createdAt},
                completed_at = ${completedAt}
              WHERE invocation_id = ${event.invocationId}
            `;
            }

            return { sequence, event } satisfies PersistedHarnessInvocationEvent;
          }),
        )
        .pipe(
          Effect.mapError((error) =>
            error instanceof PersistenceDecodeError
              ? error
              : toPersistenceSqlError("HarnessInvocationTrace.append")(error),
          ),
        );
      return persisted;
    });

  const getById: HarnessInvocationTraceRepositoryShape["getById"] = (input) =>
    readInvocationRows(input).pipe(
      Effect.mapError(toPersistenceSqlError("HarnessInvocationTrace.getById")),
      Effect.flatMap((rows) =>
        decodeInvocationRows(rows, "HarnessInvocationTrace.getById").pipe(
          Effect.map((decoded) =>
            decoded[0] === undefined ? Option.none() : Option.some(decoded[0]),
          ),
        ),
      ),
    );

  const readEvents: HarnessInvocationTraceRepositoryShape["readEvents"] = (input) => {
    const sequenceExclusive = input.sequenceExclusive ?? 0;
    return sql<Record<string, unknown>>`
      SELECT sequence, event_json AS "eventJson"
      FROM harness_invocation_events
      WHERE invocation_id = ${input.invocationId}
        AND sequence > ${sequenceExclusive}
      ORDER BY sequence ASC
      LIMIT ${input.limit}
    `.pipe(
      Effect.mapError(toPersistenceSqlError("HarnessInvocationTrace.readEvents")),
      Effect.flatMap((rows) =>
        Effect.forEach(rows, (row) =>
          decodeRawEventRow(row).pipe(
            Effect.mapError(toPersistenceDecodeError("HarnessInvocationTrace.readEvents.row")),
            Effect.flatMap((decoded) =>
              decodeEvent(decoded.eventJson).pipe(
                Effect.mapError(
                  toPersistenceDecodeError("HarnessInvocationTrace.readEvents.event"),
                ),
                Effect.map((event) => ({ sequence: decoded.sequence, event })),
              ),
            ),
          ),
        ),
      ),
    );
  };

  const getRecoveryDecision: HarnessInvocationTraceRepositoryShape["getRecoveryDecision"] = (
    input,
  ) =>
    getById(input).pipe(
      Effect.map((recordOption) =>
        Option.map(recordOption, (record) => {
          const action =
            record.state === "completed"
              ? "replay"
              : record.state === "unknown"
                ? "reconcile"
                : isRetryEligibleState(record.state)
                  ? "retry"
                  : "resume";
          return {
            invocationId: record.invocationId,
            action,
            attempt: record.currentAttempt,
          } satisfies HarnessInvocationRecoveryDecision;
        }),
      ),
    );

  const getHighWaterSequence: HarnessInvocationTraceRepositoryShape["getHighWaterSequence"] = sql<{
    readonly highWaterSequence: number;
  }>`
    SELECT COALESCE(MAX(sequence), 0) AS "highWaterSequence"
    FROM harness_invocation_events
  `.pipe(
    Effect.map((rows) => rows[0]?.highWaterSequence ?? 0),
    Effect.mapError(toPersistenceSqlError("HarnessInvocationTrace.getHighWaterSequence")),
  );

  const listByThread: HarnessInvocationTraceRepositoryShape["listByThread"] = (input) =>
    readInvocationRows(input).pipe(
      Effect.mapError(toPersistenceSqlError("HarnessInvocationTrace.listByThread")),
      Effect.flatMap((rows) => decodeInvocationRows(rows, "HarnessInvocationTrace.listByThread")),
    );

  return {
    append,
    getById,
    readEvents,
    getRecoveryDecision,
    getHighWaterSequence,
    listByThread,
  } satisfies HarnessInvocationTraceRepositoryShape;
});

export const HarnessInvocationTraceRepositoryLive = Layer.effect(
  HarnessInvocationTraceRepository,
  make,
);
