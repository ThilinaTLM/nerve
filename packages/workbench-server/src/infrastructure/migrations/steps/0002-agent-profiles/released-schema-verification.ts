import assert from "node:assert/strict";

export interface TableSql {
  name: string;
  sql: unknown;
}

/** SQLite may quote identifiers on rename. Ignore layout outside quoted tokens
 * and comments. Keep literal contents and comment boundaries semantically exact. */
function normalizedSql(sql: unknown): string {
  assert(typeof sql === "string", "Missing table SQL");
  const tokens =
    sql.match(
      /--[^\r\n]*(?:\r?\n|$)|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[[^\]]*\]|[\w$]+|[^\s]/g,
    ) ?? [];
  if (tokens.at(-1) === ";") tokens.pop();
  return tokens
    .map((token) =>
      /^"[A-Za-z_][\w$]*"$/.test(token) ? token.slice(1, -1) : token,
    )
    .join(" ");
}

/** New final tables introduced by the reviewed SQL, excluding rebuilt originals. */
export function reviewedNewTables(
  original: readonly TableSql[],
  reviewedSql: string,
): TableSql[] {
  const existing = new Set(original.map((table) => table.name));
  const renames = new Map(
    [...reviewedSql.matchAll(/ALTER TABLE (\w+) RENAME TO (\w+);/g)].map(
      (match) => [match[1], match[2]],
    ),
  );
  return [...reviewedSql.matchAll(/CREATE TABLE (\w+) \([\s\S]*?\) STRICT;/g)]
    .map((match) => {
      const name = renames.get(match[1]) ?? match[1];
      return {
        name,
        sql: match[0].replace(
          `CREATE TABLE ${match[1]} (`,
          `CREATE TABLE ${name} (`,
        ),
      };
    })
    .filter((table) => !existing.has(table.name));
}

/** Compare complete sqlite_master table definitions, not just foreign_key_list:
 * that PRAGMA omits DEFERRABLE / INITIALLY DEFERRED. All surviving original
 * tables are checked, so inbound FKs cannot evade this check by being removed. */
export function verifyConvertedTableSql(
  actual: readonly TableSql[],
  original: readonly TableSql[],
  reviewedSql: string,
): void {
  const current = new Map(actual.map((table) => [table.name, table.sql]));
  const baseline = new Map(original.map((table) => [table.name, table.sql]));
  assert.equal(current.size, actual.length, "Duplicate converted table");
  assert.equal(baseline.size, original.length, "Duplicate original table");
  assert(
    baseline.delete("conversation_config"),
    "Released configuration table missing",
  );
  for (const table of reviewedNewTables(original, reviewedSql))
    baseline.set(table.name, table.sql);
  assert.deepEqual(
    [...current.keys()].sort(),
    [...baseline.keys()].sort(),
    "Unexpected converted table set",
  );
  for (const [name, originalSql] of baseline) {
    let expected = originalSql;
    if (name === "conversation" || name === "trusted_resource") {
      const start = reviewedSql.indexOf(`CREATE TABLE ${name}_new (`);
      const end = reviewedSql.indexOf(") STRICT;", start);
      assert(start >= 0 && end > start, "Reviewed table definition missing");
      expected = reviewedSql
        .slice(start, end + ") STRICT;".length)
        .replace(`${name}_new`, name);
    }
    assert.equal(
      normalizedSql(current.get(name)),
      normalizedSql(expected),
      `Converted table SQL changed: ${name}`,
    );
  }
}
