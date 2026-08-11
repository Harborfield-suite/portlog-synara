import { MessageId, ThreadId, TurnId } from "@synara/contracts";
import { assert, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "./Sqlite.ts";
import { ProjectionTurnRepositoryLive } from "./ProjectionTurns.ts";
import { ProjectionTurnRepository } from "../Services/ProjectionTurns.ts";

const projectionTurnsLayer = it.layer(
  Layer.mergeAll(
    ProjectionTurnRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
    SqlitePersistenceMemory,
  ),
);

const modelSelection = {
  model: "gpt-5.4",
} as const;

projectionTurnsLayer("Projection turn contract", (it) => {
  it.effect("creates one durable lifecycle row and preserves its model snapshot", () =>
    Effect.gen(function* () {
      const turns = yield* ProjectionTurnRepository;
      const sql = yield* SqlClient.SqlClient;
      const threadId = ThreadId.makeUnsafe("turn-contract-thread");
      const messageId = MessageId.makeUnsafe("turn-contract-message");
      const turnId = TurnId.makeUnsafe("turn-contract-id");
      const requestedAt = "2026-08-10T05:00:00.000Z";

      // The request boundary may be replayed. Replacing the same pending message
      // must leave one durable turn placeholder, not duplicate the user turn.
      const pending = {
        threadId,
        messageId,
        modelSelection,
        sourceProposedPlanThreadId: null,
        sourceProposedPlanId: null,
        requestedAt,
      } as const;
      yield* turns.replacePendingTurnStart(pending);
      yield* turns.replacePendingTurnStart(pending);

      const pendingRow = yield* turns.getPendingTurnStartByThreadId({ threadId });
      assert.deepStrictEqual(Option.getOrNull(pendingRow), pending);

      yield* turns.upsertByTurnId({
        threadId,
        turnId,
        modelSelection,
        pendingMessageId: messageId,
        sourceProposedPlanThreadId: null,
        sourceProposedPlanId: null,
        assistantMessageId: null,
        state: "running",
        requestedAt,
        startedAt: "2026-08-10T05:00:01.000Z",
        completedAt: null,
        checkpointTurnCount: null,
        checkpointRef: null,
        checkpointStatus: null,
        checkpointFiles: [],
      });
      yield* turns.upsertByTurnId({
        threadId,
        turnId,
        modelSelection: {
          model: "deepseek/deepseek-chat-v4-flash",
        },
        pendingMessageId: messageId,
        sourceProposedPlanThreadId: null,
        sourceProposedPlanId: null,
        assistantMessageId: null,
        state: "completed",
        requestedAt,
        startedAt: "2026-08-10T05:00:01.000Z",
        completedAt: "2026-08-10T05:00:02.000Z",
        checkpointTurnCount: null,
        checkpointRef: null,
        checkpointStatus: null,
        checkpointFiles: [],
      });
      yield* turns.deletePendingTurnStartByThreadId({ threadId });

      const durableTurn = yield* turns.getByTurnId({ threadId, turnId });
      assert.deepStrictEqual(Option.getOrNull(durableTurn), {
        threadId,
        turnId,
        modelSelection,
        pendingMessageId: messageId,
        sourceProposedPlanThreadId: null,
        sourceProposedPlanId: null,
        assistantMessageId: null,
        state: "completed",
        requestedAt,
        startedAt: "2026-08-10T05:00:01.000Z",
        completedAt: "2026-08-10T05:00:02.000Z",
        checkpointTurnCount: null,
        checkpointRef: null,
        checkpointStatus: null,
        checkpointFiles: [],
      });

      const rowCount = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count
        FROM projection_turns
        WHERE thread_id = ${threadId}
      `;
      assert.strictEqual(rowCount[0]?.count, 1);
      const rawRows = yield* sql<{ readonly modelSelectionJson: string | null }>`
        SELECT model_selection_json AS "modelSelectionJson"
        FROM projection_turns
        WHERE thread_id = ${threadId} AND turn_id = ${turnId}
      `;
      assert.deepStrictEqual(JSON.parse(rawRows[0]!.modelSelectionJson!), {
        model: "gpt-5.4",
      });
      assert.isFalse("provider" in JSON.parse(rawRows[0]!.modelSelectionJson!));

      // Rows written by the previous provider-bearing contract remain readable,
      // but the repository exposes only the provider-free snapshot.
      yield* sql`
        UPDATE projection_turns
        SET model_selection_json = ${JSON.stringify({
          provider: "codex",
          model: "gpt-5.4",
        })}
        WHERE thread_id = ${threadId} AND turn_id = ${turnId}
      `;
      const legacyTurn = yield* turns.getByTurnId({ threadId, turnId });
      assert.deepStrictEqual(Option.getOrNull(legacyTurn)?.modelSelection, modelSelection);

      const columns = yield* sql<{ readonly name: string }>`
        SELECT name
        FROM pragma_table_info('projection_turns')
      `;
      assert.isTrue(columns.some(({ name }) => name === "model_selection_json"));
      assert.isFalse(columns.some(({ name }) => name === "provider_name"));
    }),
  );

  it.effect("preserves distinct queued messages as distinct pending turns", () =>
    Effect.gen(function* () {
      const turns = yield* ProjectionTurnRepository;
      const threadId = ThreadId.makeUnsafe("queued-turn-thread");
      const first = {
        threadId,
        messageId: MessageId.makeUnsafe("queued-message-1"),
        modelSelection,
        sourceProposedPlanThreadId: null,
        sourceProposedPlanId: null,
        requestedAt: "2026-08-10T05:01:00.000Z",
      } as const;
      const second = {
        ...first,
        messageId: MessageId.makeUnsafe("queued-message-2"),
        modelSelection: {
          model: "deepseek/deepseek-chat-v4-flash",
        },
        requestedAt: "2026-08-10T05:02:00.000Z",
      } as const;

      yield* turns.replacePendingTurnStart(first);
      yield* turns.replacePendingTurnStart(second);

      assert.deepStrictEqual(
        Option.getOrNull(yield* turns.getPendingTurnStartByThreadId({ threadId })),
        first,
      );
      yield* turns.deletePendingTurnStartByThreadId({
        threadId,
        messageId: first.messageId,
      });
      assert.deepStrictEqual(
        Option.getOrNull(yield* turns.getPendingTurnStartByThreadId({ threadId })),
        second,
      );
      yield* turns.deletePendingTurnStartByThreadId({ threadId });
      assert.isTrue(Option.isNone(yield* turns.getPendingTurnStartByThreadId({ threadId })));
    }),
  );
});
