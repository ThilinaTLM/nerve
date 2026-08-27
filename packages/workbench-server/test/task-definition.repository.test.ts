import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import type { ProjectRecord } from "@nervekit/contracts";
import { TaskDefinitionRepository } from "../src/domains/task-definitions/task-definition.repository.js";
import { ProjectRepository } from "../src/domains/projects/project.repository.js";
import { initializeStorage } from "../src/infrastructure/storage/index.js";

const roots: string[] = [];
const stores: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.close()));
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("project task definition storage", () => {
  it("derives runtime scope from the local project and writes portable files", async () => {
    const { project, repository } = await setup();
    const path = join(project.dir, ".nerve", "tasks", "definitions.json");
    await mkdir(join(project.dir, ".nerve", "tasks"), { recursive: true });
    const now = new Date().toISOString();
    await writeFile(
      path,
      `${JSON.stringify({
        version: 1,
        definitions: [
          {
            id: "taskdef_foreign",
            scope: { kind: "project", projectId: "proj_other_installation" },
            command: "pnpm check",
            createdAt: now,
            updatedAt: now,
          },
          {
            id: "taskdef_portable",
            scope: { kind: "project" },
            command: "pnpm test",
            createdAt: now,
            updatedAt: now,
          },
        ],
      })}\n`,
    );

    const loaded = await repository.list(project.id);
    assert.deepEqual(
      loaded.map((definition) => definition.scope),
      [
        { kind: "project", projectId: project.id },
        { kind: "project", projectId: project.id },
      ],
    );

    await repository.replace(project.id, loaded);
    const persisted = JSON.parse(await readFile(path, "utf8")) as {
      definitions: Array<{ scope: Record<string, unknown> }>;
    };
    assert.deepEqual(
      persisted.definitions.map((definition) => definition.scope),
      [{ kind: "project" }, { kind: "project" }],
    );
  });

  it("rejects unsupported project task definition files", async () => {
    const { project, repository } = await setup();
    const dir = join(project.dir, ".nerve", "tasks");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "definitions.json"),
      `${JSON.stringify({ version: 2, definitions: [] })}\n`,
    );

    await assert.rejects(
      repository.list(project.id),
      /Invalid project task definitions.*definitions\.json/,
    );
  });
});

async function setup(): Promise<{
  project: ProjectRecord;
  repository: TaskDefinitionRepository;
}> {
  const root = await mkdtemp(join(tmpdir(), "nerve-task-definitions-"));
  roots.push(root);
  const storage = await initializeStorage(join(root, "home"));
  stores.push(storage.canonicalStore);
  const now = new Date().toISOString();
  const project: ProjectRecord = {
    id: "proj_local_installation",
    name: "Portable project",
    dir: join(root, "project"),
    createdAt: now,
    updatedAt: now,
  };
  await mkdir(project.dir, { recursive: true });
  await new ProjectRepository(storage).write(project);
  return { project, repository: new TaskDefinitionRepository(storage) };
}
