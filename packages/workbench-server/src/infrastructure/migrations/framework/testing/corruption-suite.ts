import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { TestContext } from "node:test";
import { storagePaths } from "../../../storage-bootstrap/paths.js";
import {
  discardFailedItems,
  readMigrationFailureReport,
  rollbackFailedMigration,
} from "../recovery.js";
import { runMigrations } from "../runner.js";
import type { RegisteredStep } from "../step.js";

async function files(root: string): Promise<string[]> {
  const result: string[] = [];
  async function visit(dir: string) {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) result.push(path);
    }
  }
  await visit(root);
  return result;
}
async function snapshot(home: string) {
  const result: Record<string, string> = {};
  for (const path of await files(home)) {
    const name = relative(home, path).split(sep).join("/");
    if (name.startsWith("migrations/")) continue;
    result[name] = createHash("sha256")
      .update(await readFile(path))
      .digest("hex");
  }
  return result;
}
export interface CorruptionSuiteOptions {
  registry: readonly RegisteredStep[];
  makeFixture(t: TestContext): Promise<string>;
  /** Owned JSON roots and required files, relative to the fixture home. */
  units?: { jsonRoots?: string[]; requiredFiles?: string[] };
  filter?: (id: string) => boolean;
  knownGaps?: Record<string, string>;
}
/** Generated cases use fresh homes, never a developer storage slot. */
export async function corruptionSuite(
  t: TestContext,
  options: CorruptionSuiteOptions,
) {
  const sample = await options.makeFixture(t);
  const roots = options.units?.jsonRoots ?? ["config", "data/conversations"];
  const cases: {
    id: string;
    homeWide?: boolean;
    damage(home: string): Promise<void>;
  }[] = [];
  for (const path of await files(sample)) {
    const name = relative(sample, path);
    if (
      name.endsWith(".json") &&
      roots.some((root) => name.startsWith(`${root}/`))
    )
      cases.push({
        id: `json:${name}`,
        damage: (home) => writeFile(join(home, name), '{"'),
      });
  }
  const db = new DatabaseSync(join(sample, "data/nerve.sqlite"), {
    readOnly: true,
  });
  try {
    for (const [table, column] of [
      ["domain_documents", "namespace"],
      ["conversation_records", "kind"],
    ]) {
      const kinds = db
        .prepare(
          `SELECT DISTINCT ${column} AS kind FROM ${table} ORDER BY ${column}`,
        )
        .all();
      for (const row of kinds) {
        const kind = String(row.kind);
        cases.push({
          id: `record:${table}:${kind}`,
          damage: async (home) => {
            const target = new DatabaseSync(join(home, "data/nerve.sqlite"));
            try {
              target
                .prepare(
                  `UPDATE ${table} SET data = ? WHERE rowid = (SELECT rowid FROM ${table} WHERE ${column} = ? ORDER BY rowid LIMIT 1)`,
                )
                .run(Buffer.from("garbage"), kind);
            } finally {
              target.close();
            }
          },
        });
      }
    }
  } finally {
    db.close();
  }
  for (const name of options.units?.requiredFiles ?? [
    "manifest.json",
    "data/nerve.sqlite",
  ])
    cases.push({
      id: `missing:${name}`,
      homeWide: ["manifest.json", "data/nerve.sqlite"].includes(name),
      damage: (home) => rm(join(home, name)),
    });
  for (const item of cases) {
    if (options.filter && !options.filter(item.id)) continue;
    await t.test(
      item.id,
      { todo: options.knownGaps?.[item.id] },
      async (child) => {
        const home = await options.makeFixture(child);
        await item.damage(home);
        const before = await snapshot(home);
        let failed = false;
        try {
          await runMigrations(home, { registry: options.registry });
        } catch {
          failed = true;
        }
        if (!failed) return; // Optional/runtime-owned inputs may safely be ignored.
        const report = await readMigrationFailureReport(storagePaths(home));
        assert.ok(item.homeWide || report?.discardable?.length, report?.error);
        if (item.homeWide && !report?.rollbackAvailable) {
          assert.deepEqual(
            await snapshot(home),
            before,
            "admission failure must not change sources",
          );
          return;
        }
        assert.ok(report?.rollbackAvailable, "failure must retain rollback");
        await rollbackFailedMigration(home, { registry: options.registry });
        assert.deepEqual(await snapshot(home), before);
        if (item.homeWide) return;
        await assert.rejects(
          runMigrations(home, { registry: options.registry }),
        );
        const retry = await readMigrationFailureReport(storagePaths(home));
        await discardFailedItems(
          home,
          retry!.discardable!.map((item) => item.id),
          { registry: options.registry },
        );
        await runMigrations(home, { registry: options.registry });
      },
    );
  }
  const phases = new Set<string>();
  const home = await options.makeFixture(t);
  await runMigrations(home, {
    registry: options.registry,
    onProgress: (progress) => {
      phases.add(progress.phase);
    },
  });
  for (const phase of phases) {
    if (options.filter && !options.filter(`crash:${phase}`)) continue;
    await t.test(`crash:${phase}`, async (child) => {
      const target = await options.makeFixture(child);
      let crashed = false;
      await assert.rejects(
        runMigrations(target, {
          registry: options.registry,
          onProgress: (progress) => {
            if (!crashed && progress.phase === phase) {
              crashed = true;
              throw new Error("injected crash");
            }
          },
        }),
      );
      assert.ok(crashed);
      await runMigrations(target, { registry: options.registry });
    });
  }
}
