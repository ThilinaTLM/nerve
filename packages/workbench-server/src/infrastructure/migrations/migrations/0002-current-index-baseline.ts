import { MIGRATION_0002_INDEX_SCHEMA_SQL } from "./0002-index-schema.js";
import { pathExists } from "../../storage/json.js";
import { tableNames } from "../sqlite.js";
import type { StorageMigration } from "../migration.js";
import { migrationChecksum } from "../checksum.js";

const expectedTables = new Set([
  "index_meta",
  "projects",
  "conversations",
  "agents",
  "tasks",
  "workers",
  "tool_calls",
  "prompt_suggestion_trust",
]);

function hasCurrentTables(names: Set<string>): boolean {
  return [...expectedTables].every((name) => names.has(name));
}

export const migration0002: StorageMigration = {
  id: "0002-current-index-baseline",
  description: "Establish the current rebuildable SQLite index schema",
  checksum: migrationChecksum(
    "0002-current-index-baseline|v1|Establish the current rebuildable SQLite index schema",
  ),
  async detect(context) {
    if (!(await pathExists(context.paths.sqlitePath))) return "pending";
    return context.withDatabase((database) =>
      hasCurrentTables(tableNames(database)) ? "current" : "pending",
    );
  },
  async backup() {
    return { paths: [] };
  },
  async up(context) {
    context.transaction((database) =>
      database.exec(MIGRATION_0002_INDEX_SCHEMA_SQL),
    );
  },
  async verify(context) {
    const current = context.withDatabase((database) =>
      hasCurrentTables(tableNames(database)),
    );
    if (!current) throw new Error("SQLite index schema is incomplete.");
  },
};
