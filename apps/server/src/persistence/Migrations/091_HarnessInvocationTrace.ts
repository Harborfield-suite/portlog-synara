import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Provider-neutral durable invocation trace.
 *
 * The invocation projection is rebuildable from the append-only event table;
 * it exists to make recovery queries cheap and to expose the latest semantic
 * checkpoint/result without replaying the whole stream on every request.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS harness_invocations (
      invocation_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      turn_id TEXT NOT NULL,
      target_kind TEXT NOT NULL CHECK (target_kind IN ('model', 'tool', 'logic_program')),
      target_json TEXT NOT NULL,
      state TEXT NOT NULL CHECK (
        state IN ('running', 'completed', 'failed', 'unknown', 'interrupted', 'cancelled')
      ),
      current_attempt INTEGER NOT NULL CHECK (current_attempt >= 1),
      checkpoint_json TEXT,
      result_json TEXT,
      error_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_harness_invocations_thread_created
    ON harness_invocations(thread_id, created_at, invocation_id)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_harness_invocations_recovery
    ON harness_invocations(state, updated_at)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS harness_invocation_events (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE,
      invocation_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      turn_id TEXT NOT NULL,
      attempt INTEGER NOT NULL CHECK (attempt >= 1),
      event_type TEXT NOT NULL CHECK (
        event_type IN (
          'invocation.started',
          'invocation.resumed',
          'invocation.checkpointed',
          'invocation.completed',
          'invocation.failed',
          'invocation.unknown',
          'invocation.interrupted',
          'invocation.cancelled'
        )
      ),
      event_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (invocation_id) REFERENCES harness_invocations(invocation_id) ON DELETE CASCADE
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_harness_invocation_events_invocation_sequence
    ON harness_invocation_events(invocation_id, sequence)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_harness_invocation_events_turn_sequence
    ON harness_invocation_events(thread_id, turn_id, sequence)
  `;
});
