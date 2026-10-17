import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { runMigrations } from "../../framework/runner.js";
import { fixture, registry } from "./step-fixture.js";

void test("unowned home and project JSON is neither read nor rewritten", async (t) => {
  const home = await fixture(t);
  const project = join(home, "project/.nerve/config");
  await mkdir(project, { recursive: true });
  const paths = [
    join(home, "config/settings.json"),
    join(home, "config/mcp.json"),
    join(project, "mcp.json"),
  ];
  for (const path of paths) await writeFile(path, "not JSON");
  await runMigrations(home, { registry });
  for (const path of paths)
    assert.equal(await readFile(path, "utf8"), "not JSON");
});

void test("configuration check fails before source rename or conversion writes", async (t) => {
  const home = await fixture(t);
  const path = join(home, "config/prompt-suggestions.json");
  await writeFile(path, "not JSON");
  const before = await readFile(join(home, "config/harness.json"));
  await assert.rejects(
    runMigrations(home, { registry }),
    /configuration file could not be upgraded/,
  );
  assert(existsSync(join(home, "data/nerve.sqlite")));
  assert(!existsSync(join(home, "data/nerve.sqlite.migrating")));
  assert.deepEqual(await readFile(join(home, "config/harness.json")), before);
  assert.equal(await readFile(path, "utf8"), "not JSON");
});
