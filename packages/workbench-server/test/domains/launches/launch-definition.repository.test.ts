import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import type { Project } from "@nervekit/contracts/core";
import { LaunchDefinitionRepository } from "../../../src/domains/launch-definitions/launch-definition.repository.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("project launch definition storage", () => {
  it("derives runtime scope from the local project and writes portable files", async () => {
    const { project, repository } = await setup();
    const path = join(
      project.directory,
      ".nerve",
      "launches",
      "definitions.json",
    );
    await mkdir(join(project.directory, ".nerve", "launches"), {
      recursive: true,
    });
    const now = new Date().toISOString();
    await writeFile(
      path,
      `${JSON.stringify({
        version: 1,
        definitions: [
          {
            id: "launchdef_foreign",
            scope: { kind: "project", projectId: "proj_other_installation" },
            command: "pnpm check",
            createdAt: now,
            updatedAt: now,
          },
          {
            id: "launchdef_portable",
            scope: { kind: "project" },
            command: "pnpm test",
            createdAt: now,
            updatedAt: now,
          },
        ],
      })}\n`,
    );

    const loaded = await repository.catalog(project.id);
    assert.deepEqual(
      loaded.definitions.map((definition) => definition.scope),
      [
        { kind: "project", projectId: project.id },
        { kind: "project", projectId: project.id },
      ],
    );

    const committed = await repository.transact(
      project.id,
      loaded.revision,
      (catalog) => {
        catalog.definitions[0]!.command = "pnpm check:focused";
      },
    );
    assert.equal(committed.changed, true);
    assert.notEqual(committed.revision, loaded.revision);
    const persisted = JSON.parse(await readFile(path, "utf8")) as {
      version: number;
      folders: unknown[];
      definitions: Array<{
        scope: Record<string, unknown>;
        command: string;
        parentFolderId: string | null;
        order: number;
      }>;
    };
    assert.equal(persisted.version, 2);
    assert.deepEqual(persisted.folders, []);
    assert.equal(persisted.definitions[0]!.command, "pnpm check:focused");
    assert.deepEqual(
      persisted.definitions.map(({ parentFolderId, order }) => ({
        parentFolderId,
        order,
      })),
      [
        { parentFolderId: null, order: 0 },
        { parentFolderId: null, order: 1 },
      ],
    );
    assert.equal(
      (await repository.catalog(project.id)).revision,
      committed.revision,
    );
    assert.deepEqual(
      persisted.definitions.map((definition) => definition.scope),
      [{ kind: "project" }, { kind: "project" }],
    );
  });

  it("rejects unknown nested v2 fields without rewriting source bytes", async () => {
    const { project, repository } = await setup();
    const dir = join(project.directory, ".nerve", "launches");
    await mkdir(dir, { recursive: true });
    const path = join(dir, "definitions.json");
    const now = new Date().toISOString();
    const folder = {
      id: "launchfolder_one",
      label: "One",
      parentFolderId: null,
      order: 0,
    };
    const definition = {
      id: "launchdef_one",
      scope: { kind: "project" },
      command: "echo test",
      createdAt: now,
      updatedAt: now,
      parentFolderId: folder.id,
      order: 0,
    };
    const valid = { version: 2, folders: [folder], definitions: [definition] };
    const cases = [
      { ...valid, folders: [{ ...folder, futureFolderField: true }] },
      {
        ...valid,
        definitions: [{ ...definition, futureDefinitionField: true }],
      },
      {
        ...valid,
        definitions: [
          { ...definition, scope: { kind: "project", futureScopeField: true } },
        ],
      },
      {
        ...valid,
        definitions: [
          { ...definition, scope: { kind: "project", projectId: project.id } },
        ],
      },
    ];
    for (const document of cases) {
      const source = `${JSON.stringify(document, null, 3)}\n`;
      await writeFile(path, source);
      await assert.rejects(
        repository.catalog(project.id),
        /Invalid project launch definitions.*definitions\.json/,
      );
      await assert.rejects(
        repository.transact(project.id, "unused", () => {
          assert.fail(
            "Invalid nested data must be rejected before invoking mutation",
          );
        }),
        /Invalid project launch definitions.*definitions\.json/,
      );
      assert.equal(await readFile(path, "utf8"), source);
    }
  });

  it("rejects unsupported project launch definition files", async () => {
    const { project, repository } = await setup();
    const dir = join(project.directory, ".nerve", "launches");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "definitions.json"),
      `${JSON.stringify({ version: 3, folders: [], definitions: [] })}\n`,
    );

    await assert.rejects(
      repository.list(project.id),
      /Invalid project launch definitions.*definitions\.json/,
    );
  });
});

async function setup(): Promise<{
  project: Project;
  repository: LaunchDefinitionRepository;
}> {
  const root = await mkdtemp(join(tmpdir(), "nerve-launch-definitions-"));
  roots.push(root);
  const now = new Date().toISOString();
  const project: Project = {
    id: "proj_local_installation",
    name: "Portable project",
    directory: join(root, "project"),
    createdAt: now,
    updatedAt: now,
  };
  await mkdir(project.directory, { recursive: true });
  return { project, repository: new LaunchDefinitionRepository(() => project) };
}
