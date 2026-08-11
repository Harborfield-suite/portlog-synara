import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("091_HarnessInvocationTrace", (it) => {
  it.effect("creates the append-only invocation tables idempotently", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 90 });

      const before = yield* sql<{ readonly name: string }>`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name IN ('harness_invocations', 'harness_invocation_events')
        ORDER BY name
      `;
      assert.deepStrictEqual(before, []);

      const applied = yield* runMigrations({ toMigrationInclusive: 91 });
      assert.deepStrictEqual(applied, [[91, "HarnessInvocationTrace"]]);

      const tables = yield* sql<{ readonly name: string }>`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name IN ('harness_invocations', 'harness_invocation_events')
        ORDER BY name
      `;
      assert.deepStrictEqual(tables, [
        { name: "harness_invocation_events" },
        { name: "harness_invocations" },
      ]);

      const invocationColumns = yield* sql<{ readonly name: string; readonly notnull: number }>`
        SELECT name, "notnull"
        FROM pragma_table_info('harness_invocations')
        WHERE name IN ('invocation_id', 'target_kind', 'current_attempt', 'checkpoint_json')
        ORDER BY name
      `;
      assert.deepStrictEqual(invocationColumns, [
        { name: "checkpoint_json", notnull: 0 },
        { name: "current_attempt", notnull: 1 },
        { name: "invocation_id", notnull: 0 },
        { name: "target_kind", notnull: 1 },
      ]);

      const replayed = yield* runMigrations({ toMigrationInclusive: 91 });
      assert.deepStrictEqual(replayed, []);
    }),
  );
});
