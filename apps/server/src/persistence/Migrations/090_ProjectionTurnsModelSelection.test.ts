import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("090_ProjectionTurnsModelSelection", (it) => {
  it.effect("adds the nullable per-turn model snapshot column idempotently", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 89 });

      const before = yield* sql<{ readonly name: string }>`
        SELECT name
        FROM pragma_table_info('projection_turns')
        WHERE name = 'model_selection_json'
      `;
      assert.deepStrictEqual(before, []);

      const applied = yield* runMigrations({ toMigrationInclusive: 90 });
      assert.deepStrictEqual(applied, [[90, "ProjectionTurnsModelSelection"]]);

      const after = yield* sql<{ readonly name: string; readonly notnull: number }>`
        SELECT name, "notnull"
        FROM pragma_table_info('projection_turns')
        WHERE name = 'model_selection_json'
      `;
      assert.deepStrictEqual(after, [{ name: "model_selection_json", notnull: 0 }]);

      const replayed = yield* runMigrations({ toMigrationInclusive: 90 });
      assert.deepStrictEqual(replayed, []);
    }),
  );
});
