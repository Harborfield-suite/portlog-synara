import { Schema } from "effect";

import {
  CheckpointRef,
  EventId,
  IsoDateTime,
  InvocationId,
  NonNegativeInt,
  PositiveInt,
  ThreadId,
  TurnId,
} from "./baseSchemas";
import { ModelSelection } from "./orchestration";

const JsonRecord = Schema.Record(Schema.String, Schema.Unknown);

export const HarnessInvocationState = Schema.Literals([
  "running",
  "completed",
  "failed",
  "unknown",
  "interrupted",
  "cancelled",
]);
export type HarnessInvocationState = typeof HarnessInvocationState.Type;

export const HarnessInvocationTarget = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("model"),
    modelSelection: ModelSelection,
    input: Schema.optional(Schema.Unknown),
  }),
  Schema.Struct({
    kind: Schema.Literal("tool"),
    toolName: Schema.String,
    input: Schema.optional(Schema.Unknown),
    deterministic: Schema.Boolean,
  }),
  Schema.Struct({
    kind: Schema.Literal("logic_program"),
    program: Schema.String,
    input: Schema.optional(Schema.Unknown),
    deterministic: Schema.Boolean,
  }),
]);
export type HarnessInvocationTarget = typeof HarnessInvocationTarget.Type;

export const HarnessInvocationCheckpoint = Schema.Struct({
  checkpointRef: CheckpointRef,
  state: Schema.Unknown,
});
export type HarnessInvocationCheckpoint = typeof HarnessInvocationCheckpoint.Type;

export const HarnessInvocationError = Schema.Struct({
  class: Schema.String,
  message: Schema.String,
  reason: Schema.optional(Schema.String),
  retryable: Schema.optional(Schema.Boolean),
});
export type HarnessInvocationError = typeof HarnessInvocationError.Type;

const InvocationPayload = Schema.Struct({
  checkpoint: Schema.optional(HarnessInvocationCheckpoint),
  result: Schema.optional(Schema.Unknown),
  error: Schema.optional(HarnessInvocationError),
  usage: Schema.optional(JsonRecord),
  reason: Schema.optional(Schema.String),
});
export type HarnessInvocationPayload = typeof InvocationPayload.Type;

export const HarnessInvocationEvent = Schema.Struct({
  eventId: EventId,
  invocationId: InvocationId,
  threadId: ThreadId,
  turnId: TurnId,
  attempt: PositiveInt,
  target: HarnessInvocationTarget,
  type: Schema.Literals([
    "invocation.started",
    "invocation.resumed",
    "invocation.checkpointed",
    "invocation.completed",
    "invocation.failed",
    "invocation.unknown",
    "invocation.interrupted",
    "invocation.cancelled",
  ]),
  createdAt: IsoDateTime,
  payload: InvocationPayload,
});
export type HarnessInvocationEvent = typeof HarnessInvocationEvent.Type;

export const HarnessInvocationRecord = Schema.Struct({
  invocationId: InvocationId,
  threadId: ThreadId,
  turnId: TurnId,
  target: HarnessInvocationTarget,
  state: HarnessInvocationState,
  currentAttempt: PositiveInt,
  checkpoint: Schema.NullOr(HarnessInvocationCheckpoint),
  result: Schema.NullOr(Schema.Unknown),
  error: Schema.NullOr(HarnessInvocationError),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  completedAt: Schema.NullOr(IsoDateTime),
});
export type HarnessInvocationRecord = typeof HarnessInvocationRecord.Type;

export const HarnessInvocationRecoveryDecision = Schema.Struct({
  invocationId: InvocationId,
  action: Schema.Literals(["replay", "retry", "reconcile", "resume"]),
  attempt: PositiveInt,
});
export type HarnessInvocationRecoveryDecision = typeof HarnessInvocationRecoveryDecision.Type;
