import {
  HarnessInvocationEvent,
  HarnessInvocationRecoveryDecision,
  HarnessInvocationRecord,
  InvocationId,
  NonNegativeInt,
  PositiveInt,
  ThreadId,
} from "@synara/contracts";
import { Option, Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { PersistenceDecodeError, PersistenceSqlError } from "../Errors.ts";

export type HarnessInvocationTraceRepositoryError = PersistenceSqlError | PersistenceDecodeError;

export const GetHarnessInvocationInput = Schema.Struct({
  invocationId: InvocationId,
});
export type GetHarnessInvocationInput = typeof GetHarnessInvocationInput.Type;

export const ReadHarnessInvocationEventsInput = Schema.Struct({
  invocationId: InvocationId,
  limit: PositiveInt,
  sequenceExclusive: Schema.optional(NonNegativeInt),
});
export type ReadHarnessInvocationEventsInput = typeof ReadHarnessInvocationEventsInput.Type;

export interface PersistedHarnessInvocationEvent {
  readonly sequence: number;
  readonly event: HarnessInvocationEvent;
}

export interface HarnessInvocationTraceRepositoryShape {
  /**
   * Append one canonical lifecycle event and update its rebuildable invocation
   * projection in the same SQLite transaction. Re-appending the same event id
   * with identical content returns the original row; changed content fails.
   */
  readonly append: (
    event: HarnessInvocationEvent,
  ) => Effect.Effect<PersistedHarnessInvocationEvent, HarnessInvocationTraceRepositoryError>;

  readonly getById: (
    input: GetHarnessInvocationInput,
  ) => Effect.Effect<Option.Option<HarnessInvocationRecord>, HarnessInvocationTraceRepositoryError>;

  readonly readEvents: (
    input: ReadHarnessInvocationEventsInput,
  ) => Effect.Effect<
    ReadonlyArray<PersistedHarnessInvocationEvent>,
    HarnessInvocationTraceRepositoryError
  >;

  /**
   * Decide how a replaced harness should continue one invocation. Completed
   * work is replayed, unknown outcomes require reconciliation, and only
   * interrupted/failed/cancelled work is eligible for a new attempt.
   */
  readonly getRecoveryDecision: (
    input: GetHarnessInvocationInput,
  ) => Effect.Effect<
    Option.Option<HarnessInvocationRecoveryDecision>,
    HarnessInvocationTraceRepositoryError
  >;

  /** Test and diagnostics hook for the stable invocation stream high-water mark. */
  readonly getHighWaterSequence: Effect.Effect<number, PersistenceSqlError>;

  /** Convenience query for all invocations associated with one thread. */
  readonly listByThread: (input: {
    readonly threadId: ThreadId;
  }) => Effect.Effect<
    ReadonlyArray<HarnessInvocationRecord>,
    HarnessInvocationTraceRepositoryError
  >;
}

export class HarnessInvocationTraceRepository extends ServiceMap.Service<
  HarnessInvocationTraceRepository,
  HarnessInvocationTraceRepositoryShape
>()("synara/persistence/Services/HarnessInvocationTraceRepository") {}
