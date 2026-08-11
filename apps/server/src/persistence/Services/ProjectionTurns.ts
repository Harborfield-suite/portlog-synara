/**
 * ProjectionTurnRepository - Projection repository interface for unified turn state.
 *
 * Owns persistence operations for pending starts, running/completed turn lifecycle,
 * and checkpoint metadata in a single projection table.
 *
 * @module ProjectionTurnRepository
 */
import {
  CheckpointRef,
  IsoDateTime,
  MessageId,
  ModelSelection,
  NonNegativeInt,
  OrchestrationProposedPlanId,
  OrchestrationCheckpointFile,
  OrchestrationCheckpointStatus,
  ThreadId,
  TrimmedNonEmptyString,
  TurnId,
} from "@synara/contracts";
import { Option, Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionTurnState = Schema.Literals([
  "pending",
  "running",
  "interrupted",
  "completed",
  "error",
]);
export type ProjectionTurnState = typeof ProjectionTurnState.Type;

/**
 * Durable turn model metadata intentionally excludes provider/session identity.
 * A turn snapshot records only the model selected for that turn.
 */
export const ProjectionTurnModelSelection = Schema.Struct({
  model: TrimmedNonEmptyString,
});
export type ProjectionTurnModelSelection = typeof ProjectionTurnModelSelection.Type;

export function toProjectionTurnModelSelection(
  modelSelection: ModelSelection | null | undefined,
): ProjectionTurnModelSelection | null | undefined {
  if (modelSelection === null || modelSelection === undefined) {
    return modelSelection;
  }
  return { model: modelSelection.model };
}


export const ProjectionTurn = Schema.Struct({
  threadId: ThreadId,
  turnId: Schema.NullOr(TurnId),
  /**
   * The resolved model captured when this turn was requested.
   * Provider/session identity belongs to the thread session projection, not a
   * durable turn snapshot.
   *
   * Optional/null keeps rows written before the turn contract migration
   * readable; new user turns populate it at the request boundary.
   */
  modelSelection: Schema.optional(Schema.NullOr(ProjectionTurnModelSelection)),
  pendingMessageId: Schema.NullOr(MessageId),
  sourceProposedPlanThreadId: Schema.NullOr(ThreadId),
  sourceProposedPlanId: Schema.NullOr(OrchestrationProposedPlanId),
  assistantMessageId: Schema.NullOr(MessageId),
  state: ProjectionTurnState,
  requestedAt: IsoDateTime,
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
  checkpointTurnCount: Schema.NullOr(NonNegativeInt),
  checkpointRef: Schema.NullOr(CheckpointRef),
  checkpointStatus: Schema.NullOr(OrchestrationCheckpointStatus),
  checkpointFiles: Schema.Array(OrchestrationCheckpointFile),
});
export type ProjectionTurn = typeof ProjectionTurn.Type;

export const ProjectionTurnById = Schema.Struct({
  threadId: ThreadId,
  turnId: TurnId,
  /**
   * Immutable per-turn model snapshot. Provider/session ownership does not
   * belong on a turn.
   */
  modelSelection: Schema.optional(Schema.NullOr(ProjectionTurnModelSelection)),
  pendingMessageId: Schema.NullOr(MessageId),
  sourceProposedPlanThreadId: Schema.NullOr(ThreadId),
  sourceProposedPlanId: Schema.NullOr(OrchestrationProposedPlanId),
  assistantMessageId: Schema.NullOr(MessageId),
  state: ProjectionTurnState,
  requestedAt: IsoDateTime,
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
  checkpointTurnCount: Schema.NullOr(NonNegativeInt),
  checkpointRef: Schema.NullOr(CheckpointRef),
  checkpointStatus: Schema.NullOr(OrchestrationCheckpointStatus),
  checkpointFiles: Schema.Array(OrchestrationCheckpointFile),
});
export type ProjectionTurnById = typeof ProjectionTurnById.Type;

export const ProjectionPendingTurnStart = Schema.Struct({
  threadId: ThreadId,
  messageId: MessageId,
  /** Snapshot retained while the provider runtime has not produced a turn id. */
  modelSelection: Schema.optional(Schema.NullOr(ProjectionTurnModelSelection)),
  sourceProposedPlanThreadId: Schema.NullOr(ThreadId),
  sourceProposedPlanId: Schema.NullOr(OrchestrationProposedPlanId),
  requestedAt: IsoDateTime,
});
export type ProjectionPendingTurnStart = typeof ProjectionPendingTurnStart.Type;

export const ListProjectionTurnsByThreadInput = Schema.Struct({
  threadId: ThreadId,
});
export type ListProjectionTurnsByThreadInput = typeof ListProjectionTurnsByThreadInput.Type;

export const GetProjectionTurnByTurnIdInput = Schema.Struct({
  threadId: ThreadId,
  turnId: TurnId,
});
export type GetProjectionTurnByTurnIdInput = typeof GetProjectionTurnByTurnIdInput.Type;

export interface ProjectionTurnWaitSnapshot {
  readonly existingThreadIds: ReadonlyArray<GetProjectionTurnByTurnIdInput["threadId"]>;
  readonly turns: ReadonlyArray<{
    readonly threadId: GetProjectionTurnByTurnIdInput["threadId"];
    readonly turnId: GetProjectionTurnByTurnIdInput["turnId"];
    readonly state: ProjectionTurnState;
  }>;
}

export const GetProjectionPendingTurnStartInput = Schema.Struct({
  threadId: ThreadId,
  /** Optional identity filter; omitted means the oldest queued placeholder. */
  messageId: Schema.optional(MessageId),
});
export type GetProjectionPendingTurnStartInput = typeof GetProjectionPendingTurnStartInput.Type;

export const DeleteProjectionTurnsByThreadInput = Schema.Struct({
  threadId: ThreadId,
});
export type DeleteProjectionTurnsByThreadInput = typeof DeleteProjectionTurnsByThreadInput.Type;

export const ClearCheckpointTurnConflictInput = Schema.Struct({
  threadId: ThreadId,
  turnId: TurnId,
  checkpointTurnCount: NonNegativeInt,
});
export type ClearCheckpointTurnConflictInput = typeof ClearCheckpointTurnConflictInput.Type;

export interface ProjectionTurnRepositoryShape {
  /**
   * Inserts or updates the canonical row for a concrete `{threadId, turnId}` turn lifecycle state.
   */
  readonly upsertByTurnId: (
    row: ProjectionTurnById,
  ) => Effect.Effect<void, ProjectionRepositoryError>;

  /**
   * Replaces the pending-start placeholder for this message, preserving other
   * queued user messages in the same thread.
   */
  readonly replacePendingTurnStart: (
    row: ProjectionPendingTurnStart,
  ) => Effect.Effect<void, ProjectionRepositoryError>;

  /**
   * Returns the oldest pending-start placeholder for FIFO queued-turn promotion.
   */
  readonly getPendingTurnStartByThreadId: (
    input: GetProjectionPendingTurnStartInput,
  ) => Effect.Effect<Option.Option<ProjectionPendingTurnStart>, ProjectionRepositoryError>;

  /**
   * Deletes a pending-start placeholder, or all pending placeholders when no
   * message identity is supplied. Concrete turn rows remain untouched.
   */
  readonly deletePendingTurnStartByThreadId: (
    input: GetProjectionPendingTurnStartInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;

  /**
   * Lists all projection rows for a thread, including pending placeholders, with checkpoint rows ordered before non-checkpoint rows.
   */
  readonly listByThreadId: (
    input: ListProjectionTurnsByThreadInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionTurn>, ProjectionRepositoryError>;

  /**
   * Looks up a concrete turn row by `{threadId, turnId}` and never returns pending placeholder rows.
   */
  readonly getByTurnId: (
    input: GetProjectionTurnByTurnIdInput,
  ) => Effect.Effect<Option.Option<ProjectionTurnById>, ProjectionRepositoryError>;

  /** Batch lookup used by long-poll status readers to avoid one query per turn. */
  readonly getManyByTurnId: (
    input: ReadonlyArray<GetProjectionTurnByTurnIdInput>,
  ) => Effect.Effect<ReadonlyArray<ProjectionTurnById>, ProjectionRepositoryError>;

  /** One lightweight query for pinned turn states plus current thread existence. */
  readonly getManyWaitSnapshot: (input: {
    readonly threadIds: ReadonlyArray<GetProjectionTurnByTurnIdInput["threadId"]>;
    readonly turns: ReadonlyArray<GetProjectionTurnByTurnIdInput>;
  }) => Effect.Effect<ProjectionTurnWaitSnapshot, ProjectionRepositoryError>;

  /**
   * Clears checkpoint fields on conflicting rows that reuse the same checkpoint turn count in a thread, excluding the provided turn.
   */
  readonly clearCheckpointTurnConflict: (
    input: ClearCheckpointTurnConflictInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;

  /**
   * Hard-deletes all projection rows for a thread, including pending-start placeholders and checkpoint metadata rows.
   */
  readonly deleteByThreadId: (
    input: DeleteProjectionTurnsByThreadInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class ProjectionTurnRepository extends ServiceMap.Service<
  ProjectionTurnRepository,
  ProjectionTurnRepositoryShape
>()("synara/persistence/Services/ProjectionTurns/ProjectionTurnRepository") {}
