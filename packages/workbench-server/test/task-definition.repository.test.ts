import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { TaskDefinitionRepository } from "../src/domains/task-definitions/task-definition.repository.js";
import { initializeStorage } from "../src/infrastructure/storage/index.js";

test("migrates pinned commands to durable task definitions once", async () => {
  const home = await mkdtemp(join(tmpdir(), "nerve-task-definitions-"));
  try {
    const storage = await initializeStorage(home);
    const projectId = "proj_migration";
    const projectDir = join(home, "projects", projectId);
    await mkdir(projectDir, { recursive: true });
    const now = new Date().toISOString();
    await writeFile(
      join(projectDir, "pinned-commands.json"),
      JSON.stringify([
        {
          id: "pin_web",
          projectId,
          label: "Web",
          command: "pnpm dev",
          createdAt: now,
          updatedAt: now,
        },
      ]),
    );

    const definitions = await new TaskDefinitionRepository(storage).list(
      projectId,
    );
    assert.equal(definitions.length, 1);
    assert.equal(definitions[0]?.id, "taskdef_web");
    assert.equal(definitions[0]?.runPolicy, "single");
    assert.deepEqual(definitions[0]?.scope, { kind: "project", projectId });
    await assert.rejects(readFile(join(projectDir, "pinned-commands.json")));
    assert.match(
      await readFile(join(projectDir, "task-definitions.json"), "utf8"),
      /taskdef_web/,
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
