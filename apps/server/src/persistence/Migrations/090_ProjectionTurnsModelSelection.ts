/**
 * Captures the app-global model selection on each durable turn.
 *
 * The value is execution metadata only; provider/session identity remains on
 * projection_thread_sessions and is intentionally not part of the turn row.
 */
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const [column] = yield* sql<{ readonly exists: number }>`
    SELECT EXISTS(
      SELECT 1
      FROM pragma_table_info('projection_turns')
      WHERE name = 'model_selection_json'
    ) AS "exists"
  `;

  if (column?.exists !== 1) {
    yield* sql`
      ALTER TABLE projection_turns
      ADD COLUMN model_selection_json TEXT
    `;
  }
});
