import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { runMigrations } from "../../framework/runner.js";
import { fixture, registry } from "./step-fixture.js";

void test("unowned home files and all project configuration are neither read nor rewritten", async (t) => {
  const home = await fixture(t);
  const project = join(home, "project/.nerve/config");
  await mkdir(project, { recursive: true });
  const paths = [
    join(home, "config/settings.json"),
    join(home, "config/mcp.json"),
    join(project, "mcp.json"),
    ...[
      "harness",
      "ui",
      "providers",
      "integrations",
      "permissions",
      "capabilities",
      "subagents",
    ].map((name) => join(project, `${name}.json`)),
    join(project, "../tasks/definitions.json"),
    join(project, "../launches/definitions.json"),
    join(project, "../subagents/reviewer.md"),
  ];
  for (const path of paths) {
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, "not JSON");
  }
  await runMigrations(home, { registry });
  for (const path of paths)
    assert.equal(await readFile(path, "utf8"), "not JSON");
});

for (const name of ["prompt-suggestions", "ui", "providers", "permissions"]) {
  void test(`damaged ${name} is quarantined without blocking healthy conversations`, async (t) => {
    const home = await fixture(t);
    const path = join(home, `config/${name}.json`);
    await writeFile(path, "not JSON");
    await runMigrations(home, { registry });
    const report = JSON.parse(
      await readFile(
        join(home, "migrations/reports/0001-conversation-core.json"),
        "utf8",
      ),
    );
    const item = report.setAside.find(
      (item: { id: string }) => item.id === path,
    );
    assert.ok(item);
    assert.equal(
      await readFile(join(item.quarantinePath, `payload/${name}.json`), "utf8"),
      "not JSON",
    );
    assert(!existsSync(join(home, "data/nerve.sqlite.migrating")));
  });
}
