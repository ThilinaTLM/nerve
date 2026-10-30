import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { ProjectMigrationService } from "../../infrastructure/configuration/project-migration/project-migration.js";
import { launchDefinitionsConfiguration } from "./launch-definition-migrations.js";

void test("legacy tasks chain preserves source, converts IDs and placement, and resets corrupted launches", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "legacy-launches-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const context = { projectId: "proj_test", directory: join(root, "project") };
  const sourcePath = join(context.directory, ".nerve/tasks/definitions.json");
  const path = join(context.directory, ".nerve/launches/definitions.json");
  const source = JSON.stringify({
    version: 1,
    definitions: [
      {
        id: "taskdef_one",
        scope: { kind: "project", projectId: "proj_old" },
        command: "echo hello",
        runPolicy: "single",
        createdAt: "2026-10-30T00:00:00.000Z",
        updatedAt: "2026-10-30T00:00:00.000Z",
      },
    ],
  });
  await mkdir(dirname(sourcePath), { recursive: true });
  await writeFile(sourcePath, source);
  const service = new ProjectMigrationService({ home: join(root, "home") });
  const migrated = await service.load(context, launchDefinitionsConfiguration);
  assert.equal(migrated.classification, "migrated");
  assert.equal(migrated.value.definitions[0]?.id, "launchdef_one");
  assert.equal(migrated.value.definitions[0]?.parentFolderId, null);
  assert.deepEqual(migrated.value.definitions[0]?.scope, { kind: "project" });
  assert.equal(await readFile(sourcePath, "utf8"), source);
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
