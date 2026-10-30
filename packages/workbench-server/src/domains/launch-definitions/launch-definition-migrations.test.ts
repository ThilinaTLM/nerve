import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { ProjectMigrationService } from "../../infrastructure/configuration/project-migration/project-migration.js";
import { launchDefinitionsConfiguration } from "./launch-definition-migrations.js";

void test("same-file launch bump preserves placement and resets corrupted launches", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "legacy-launches-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const context = { projectId: "proj_test", directory: join(root, "project") };
  const path = join(context.directory, ".nerve/launches/definitions.json");
  const source = JSON.stringify({
    version: 1,
    definitions: [
      {
        id: "launchdef_one",
        scope: { kind: "project", projectId: "proj_old" },
        command: "echo hello",
        runPolicy: "single",
        createdAt: "2026-10-30T00:00:00.000Z",
        updatedAt: "2026-10-30T00:00:00.000Z",
      },
    ],
  });
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, source);
  const service = new ProjectMigrationService({ home: join(root, "home") });
  const migrated = await service.load(context, launchDefinitionsConfiguration);
  assert.equal(migrated.classification, "migrated");
  assert.equal(migrated.value.definitions[0]?.id, "launchdef_one");
  assert.equal(migrated.value.definitions[0]?.parentFolderId, null);
  assert.deepEqual(migrated.value.definitions[0]?.scope, { kind: "project" });
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), migrated.value);
  await writeFile(path, "invalid");
  assert.deepEqual(
    (await service.load(context, launchDefinitionsConfiguration)).value
      .definitions,
    [],
  );
  await service.reset(context, launchDefinitionsConfiguration, true);
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), {
    version: 2,
    folders: [],
    definitions: [],
  });
  assert.equal(
    (await service.reload(context, launchDefinitionsConfiguration))
      .classification,
    "healthy",
  );
});

void test("old task files and home staging are never launch sources", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "launch-notice-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const context = { projectId: "p", directory: join(root, "project") };
  const old = join(context.directory, ".nerve/tasks/definitions.json");
  await mkdir(dirname(old), { recursive: true });
  await writeFile(old, "old task bytes");
  const staged = join(
    root,
    "data/launches/legacy",
    `${createHash("sha256").update("p").digest("hex")}.json`,
  );
  await mkdir(dirname(staged), { recursive: true });
  await writeFile(staged, "obsolete home staging bytes");
  const service = new ProjectMigrationService({ home: root });
  const loaded = await service.load(context, launchDefinitionsConfiguration);
  assert.equal(loaded.classification, "healthy");
  assert.deepEqual(loaded.value.definitions, []);
  assert.equal(await readFile(old, "utf8"), "old task bytes");
  await assert.rejects(readFile(loaded.path), { code: "ENOENT" });
  assert.deepEqual(service.health("p").issues[0]?.files, [old]);
  assert.equal(await readFile(staged, "utf8"), "obsolete home staging bytes");
});
