import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { ProjectMigrationService } from "../../infrastructure/configuration/project-migration/project-migration.js";
import { launchDefinitionsConfiguration } from "./launch-definition-migrations.js";

for (const source of [
  "home",
  "project",
  "invalid-project",
  "current",
] as const) {
  void test(`legacy launch staging precedence: ${source}`, async (t) => {
    const root = await mkdtemp(join(tmpdir(), "launch-staging-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const home = join(root, "home");
    const context = {
      projectId: "proj_test",
      directory: join(root, "project"),
    };
    const staged = join(
      home,
      "data/launches/legacy",
      `${createHash("sha256").update(context.projectId).digest("hex")}.json`,
    );
    const tasks = join(context.directory, ".nerve/tasks/definitions.json");
    const launches = join(
      context.directory,
      ".nerve/launches/definitions.json",
    );
    const legacy = (name: string) =>
      JSON.stringify({
        version: 1,
        definitions: [
          {
            id: `taskdef_${name}`,
            scope: { kind: "project" },
            command: `echo ${name}`,
            runPolicy: "single",
            createdAt: "2026-10-30T00:00:00.000Z",
            updatedAt: "2026-10-30T00:00:00.000Z",
          },
        ],
      });
    const bytes = legacy("home");
    await mkdir(dirname(staged), { recursive: true });
    await writeFile(staged, bytes);
    if (source === "project" || source === "invalid-project") {
      await mkdir(dirname(tasks), { recursive: true });
      await writeFile(
        tasks,
        source === "project" ? legacy("project") : "invalid",
      );
    }
    if (source === "current") {
      await mkdir(dirname(launches), { recursive: true });
      await writeFile(
        launches,
        JSON.stringify({ version: 2, definitions: [], folders: [] }),
      );
    }
    const service = new ProjectMigrationService({ home });
    service.register(launchDefinitionsConfiguration);
    // Registration alone never opens or writes any project configuration.
    if (source !== "current")
      await assert.rejects(readFile(launches), { code: "ENOENT" });
    const result = await service.load(context, launchDefinitionsConfiguration);
    assert.equal(await readFile(staged, "utf8"), bytes);
    if (source === "invalid-project") {
      assert.equal(result.classification, "corrupted");
      assert.deepEqual(result.value.definitions, []);
      await assert.rejects(readFile(launches), { code: "ENOENT" });
    } else if (source === "current") {
      assert.equal(result.classification, "healthy");
      assert.deepEqual(result.value.definitions, []);
    } else {
      assert.equal(result.classification, "migrated");
      assert.equal(result.value.definitions[0]?.id, `launchdef_${source}`);
      assert.deepEqual(
        JSON.parse(await readFile(launches, "utf8")),
        result.value,
      );
    }
  });
}
