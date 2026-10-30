import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { LegacyReader } from "./legacy.reader.js";
import { stageLegacyLaunchDefinitions } from "./legacy-launch-definitions.js";

void test("stages all project DB documents in the home, resumes safely, and rejects conflicting data", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "legacy-launch-stage-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const timestamp = "2026-10-30T00:00:00.000Z";
  const documents = Array.from({ length: 6 }, (_, i) => ({
    row: { document_id: `proj_${i}` },
    data: [
      {
        id: `taskdef_${i}`,
        scope: { kind: "project", projectId: `proj_${i}` },
        command: `echo ${i}`,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
  }));
  const reader = {
    *documents(namespace: string) {
      assert.equal(namespace, "task_definitions");
      yield* documents;
    },
  } as unknown as LegacyReader;
  const input = { home, reader, projectId: (id: string) => id };
  assert.equal(await stageLegacyLaunchDefinitions(input), 6);
  assert.equal(await stageLegacyLaunchDefinitions(input), 0);
  for (let i = 0; i < 6; i++) {
    const path = join(
      home,
      "data",
      "launches",
      "legacy",
      `${createHash("sha256").update(`proj_${i}`).digest("hex")}.json`,
    );
    const staged = JSON.parse(await readFile(path, "utf8"));
    assert.equal(staged.version, 1);
    assert.equal(staged.definitions[0].id, `taskdef_${i}`);
    assert.deepEqual(staged.definitions[0].scope, { kind: "project" });
  }
  documents[0].data[0].command = "changed";
  await assert.rejects(
    stageLegacyLaunchDefinitions(input),
    /Conflicting staged/,
  );
});

void test("0001 stages DB launches and the feature migrates them only on load", async (t) => {
  const { fixture, registry } = await import("./step-fixture.js");
  const { runMigrations } = await import("../../framework/runner.js");
  const { ProjectMigrationService } =
    await import("../../../configuration/project-migration/project-migration.js");
  const { launchDefinitionsConfiguration } =
    await import("../../../../domains/launch-definitions/launch-definition-migrations.js");
  const home = await fixture(t);
  const directory = join(home, "project");
  const target = join(directory, ".nerve/launches/definitions.json");
  await runMigrations(home, { registry });
  await assert.rejects(readFile(target), { code: "ENOENT" });
  const stagedPath = join(
    home,
    "data/launches/legacy",
    `${createHash("sha256").update("proj_fixture").digest("hex")}.json`,
  );
  const original = await readFile(stagedPath, "utf8");
  assert.equal(JSON.parse(original).definitions[0].id, "taskdef_fixture");
  const service = new ProjectMigrationService({ home });
  const result = await service.load(
    { directory, projectId: "proj_fixture" },
    launchDefinitionsConfiguration,
  );
  assert.equal(result.classification, "migrated");
  assert.equal(result.value.definitions[0]?.id, "launchdef_fixture");
  assert.equal(await readFile(stagedPath, "utf8"), original);
});
