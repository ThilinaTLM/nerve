import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Project } from "@nervekit/contracts/core";
import { createLaunchDefinitionRequestSchema } from "@nervekit/contracts/launch-definitions";
import type { LaunchService } from "../launches/application/launch.service.js";
import { ProjectMigrationService } from "../../infrastructure/configuration/project-migration/project-migration.js";
import { LaunchDefinitionRepository } from "./launch-definition.repository.js";
import { LaunchDefinitionService } from "./launch-definition.service.js";
import { LaunchDefinitionOperations } from "./launch-definition-operations.js";

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const directory = await mkdtemp(join(tmpdir(), "launch-operations-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const project = { id: "proj_one", directory } as Project;
  const service = new LaunchDefinitionService(
    new LaunchDefinitionRepository(
      () => project,
      new ProjectMigrationService({ home: join(directory, "home") }),
    ),
    () => project,
  );
  return { project, service };
}
const request = createLaunchDefinitionRequestSchema.parse({
  command: "echo test",
  sourceLaunchId: "launch_source",
});

void test("association failure compensates saved definition through revision-checked transaction", async (t) => {
  const { project, service } = await fixture(t);
  const operations = new LaunchDefinitionOperations(
    service,
    {
      require: async () => ({ projectId: project.id }),
      associateDefinition: async () => {
        throw new Error("association failed");
      },
    } as unknown as LaunchService,
    () => [project],
  );
  await assert.rejects(
    operations.create(
      project.id,
      request,
      (await service.catalog(project.id)).revision,
    ),
    /association failed/,
  );
  assert.deepEqual((await service.catalog(project.id)).definitions, []);
});

void test("association compensation never overwrites an intervening catalog revision", async (t) => {
  const errors = t.mock.method(console, "error", () => undefined);
  const { project, service } = await fixture(t);
  const operations = new LaunchDefinitionOperations(
    service,
    {
      require: async () => ({ projectId: project.id }),
      associateDefinition: async () => {
        await service.createFolder(
          project.id,
          { label: "Intervening", parentFolderId: null, beforeSibling: null },
          (await service.catalog(project.id)).revision,
        );
        throw new Error("association failed");
      },
    } as unknown as LaunchService,
    () => [project],
  );
  await assert.rejects(
    operations.create(
      project.id,
      request,
      (await service.catalog(project.id)).revision,
    ),
    /association failed/,
  );
  const catalog = await service.catalog(project.id);
  assert.equal(catalog.folders[0].label, "Intervening");
  assert.equal(catalog.definitions.length, 1);
  assert.equal(errors.mock.callCount(), 1);
});

void test("source ownership is validated before catalog mutation", async (t) => {
  const { project, service } = await fixture(t);
  const operations = new LaunchDefinitionOperations(
    service,
    {
      require: async () => ({ projectId: "proj_other" }),
    } as unknown as LaunchService,
    () => [project],
  );
  const revision = (await service.catalog(project.id)).revision;
  await assert.rejects(
    operations.create(project.id, request, revision),
    /does not belong/,
  );
  assert.equal((await service.catalog(project.id)).revision, revision);
});

void test("launch resolves the requested project directly even when portable definition IDs duplicate", async () => {
  const requested: string[] = [];
  const projects = [
    { id: "proj_one", directory: "/one" },
    { id: "proj_two", directory: "/two" },
  ] as Project[];
  const operations = new LaunchDefinitionOperations(
    {
      get: async (projectId: string, id: string) => {
        requested.push(projectId);
        return {
          id,
          command: projectId,
          runPolicy: "single",
          cwd: "/external",
        };
      },
    } as unknown as LaunchDefinitionService,
    {
      launchDefinition: async (input: unknown) => input,
    } as unknown as LaunchService,
    () => projects,
  );
  const result = (await operations.launch(
    "proj_two",
    "launchdef_shared",
  )) as unknown as { projectId: string; command: string; cwd: string };
  assert.deepEqual(requested, ["proj_two"]);
  assert.equal(result.projectId, "proj_two");
  assert.equal(result.command, "proj_two");
  assert.equal(result.cwd, "/external");
});
