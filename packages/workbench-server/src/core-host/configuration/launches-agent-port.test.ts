import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Project } from "@nervekit/contracts/core";
import { LaunchDefinitionRepository } from "../../domains/launch-definitions/launch-definition.repository.js";
import { LaunchDefinitionService } from "../../domains/launch-definitions/launch-definition.service.js";
import { ProjectMigrationService } from "../../infrastructure/configuration/project-migration/project-migration.js";
import { createLaunchesAgentPort } from "./launches-agent-port.js";

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(join(tmpdir(), "launches-port-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, "project");
  await mkdir(directory);
  const project = { id: "proj_one", directory } as Project;
  const getProject = () => project;
  const service = new LaunchDefinitionService(
    new LaunchDefinitionRepository(
      getProject,
      new ProjectMigrationService({ home: join(root, "home") }),
    ),
    getProject,
  );
  const port = createLaunchesAgentPort({
    definitions: service,
    projectId: project.id,
  });
  return {
    port,
    file: join(directory, ".nerve", "launches", "definitions.json"),
  };
}

void test("create, update, move and remove keep order and ids consistent", async (t) => {
  const { port } = await fixture(t);
  const web = await port.create({
    label: "web",
    command: "pnpm dev",
    port: 3000,
  });
  const api = await port.create({
    command: "pnpm api",
    runPolicy: "concurrent",
  });
  assert.match(web.id, /^launchdef_/);
  assert.deepEqual([web.order, api.order], [0, 1]);

  const folder = await port.createFolder({ label: "apps" });
  await port.move(api.id, { folder: folder.id });
  await port.move(web.id, { folder: folder.id, before: api.id });
  let catalog = await port.list();
  const inside = catalog.definitions
    .filter((definition) => definition.folder === folder.id)
    .sort((a, b) => a.order - b.order);
  assert.deepEqual(
    inside.map((definition) => [definition.id, definition.order]),
    [
      [web.id, 0],
      [api.id, 1],
    ],
  );

  const updated = await port.update(web.id, {
    command: "pnpm start",
    port: null,
  });
  assert.equal(updated.command, "pnpm start");
  assert.equal(updated.label, "web");
  assert.equal(updated.port, undefined);

  await port.remove(web.id);
  catalog = await port.list();
  assert.deepEqual(
    catalog.definitions.map((definition) => [definition.id, definition.order]),
    [[api.id, 0]],
  );
});

void test("invalid input fails with what to fix", async (t) => {
  const { port } = await fixture(t);
  await assert.rejects(
    port.create({ command: "   " }),
    /Invalid launch definition: command: Command must be nonblank/,
  );
  await assert.rejects(port.create({ command: "x", port: 70000 }), /port/);
  await assert.rejects(port.remove("web"), /not a launch id.*launches\.list/);
  await assert.rejects(
    port.update("launchdef_missing", { command: "x" }),
    /not found/,
  );
  await assert.rejects(
    port.move("launchdef_missing", {}),
    /No definition or folder has this id/,
  );
});

void test("an invalid catalog on disk refuses reads and writes with the fix", async (t) => {
  const { port, file } = await fixture(t);
  await mkdir(join(file, ".."), { recursive: true });
  await writeFile(file, "{ not json");
  await assert.rejects(
    port.list(),
    /definitions\.json is invalid.*configuration\.check/s,
  );
  await assert.rejects(port.create({ command: "x" }), /changes are refused/);
});
