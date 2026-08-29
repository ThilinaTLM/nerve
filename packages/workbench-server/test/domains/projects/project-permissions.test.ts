import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import type { ProjectRecord } from "@nervekit/contracts";
import { ProjectPermissionsRepository } from "../../../src/domains/permissions/project-permissions.repository.js";
import { ProjectRepository } from "../../../src/domains/projects/project.repository.js";
import { PermissionExceptionService } from "../../../src/domains/permissions/permission-exceptions.service.js";
import type { StreamLogRegistry } from "../../../src/infrastructure/events/index.js";
import { initializeStorage } from "../../../src/infrastructure/storage-bootstrap/index.js";

const roots: string[] = [];
const stores: Array<{ close(): Promise<void> }> = [];
afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.close()));
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("project permission exceptions", () => {
  it("uses user and project permission files as authoritative sources", async () => {
    const root = await mkdtemp(join(tmpdir(), "nerve-project-permissions-"));
    roots.push(root);
    const storage = await initializeStorage(root);
    stores.push(storage.canonicalStore);
    const records = new ProjectRepository(storage);
    const now = new Date().toISOString();
    const projects = new Map<string, ProjectRecord>([
      [
        "proj_one",
        {
          id: "proj_one",
          name: "One",
          dir: join(root, "workspace-one"),
          createdAt: now,
          updatedAt: now,
        },
      ],
      [
        "proj_two",
        {
          id: "proj_two",
          name: "Two",
          dir: join(root, "workspace-two"),
          createdAt: now,
          updatedAt: now,
        },
      ],
    ]);
    await Promise.all(
      [...projects.values()].map((project) => records.write(project)),
    );

    const published: string[] = [];
    const events = {
      publish: async (type: string) => {
        published.push(type);
      },
    } as unknown as StreamLogRegistry;
    const repository = new ProjectPermissionsRepository(storage);
    const service = new PermissionExceptionService(
      storage,
      repository,
      (id) => {
        const project = projects.get(id);
        if (!project) throw new Error("Project not found");
        return project;
      },
      events,
    );
    const projectException = {
      id: "exception_project",
      tool: "bash" as const,
      effect: "allow" as const,
      rule: "gh pr view*",
    };
    const userException = {
      id: "exception_user",
      tool: "web_search" as const,
      effect: "allow" as const,
      rule: "*",
    };

    await service.add("proj_one", "project", [projectException]);
    await service.add("proj_one", "user", [userException]);

    // The unshipped legacy user-exception format is intentionally not
    // persisted into the new user overlay.
    assert.deepEqual(await service.effective("proj_one"), [projectException]);
    assert.deepEqual(await service.effective("proj_two"), []);
    const projectPermissionsPath = await repository.file("proj_one");
    assert.deepEqual(
      JSON.parse(await readFile(projectPermissionsPath, "utf8")),
      {
        version: 1,
        rules: [
          {
            id: "project",
            effect: "allow",
            tool: "bash",
            matcher: { kind: "command_glob", pattern: "gh pr view*" },
            enabled: true,
          },
        ],
      },
    );

    await writeFile(
      projectPermissionsPath,
      JSON.stringify({
        version: 1,
        rules: [
          {
            id: "manual",
            effect: "allow",
            tool: "bash",
            matcher: { kind: "command_glob", pattern: "gh issue view*" },
            enabled: true,
          },
        ],
      }),
    );
    assert.deepEqual(await service.effective("proj_one"), [
      {
        id: "exception_manual",
        tool: "bash",
        effect: "allow",
        rule: "gh issue view*",
      },
    ]);
    assert.equal(published.includes("project.permissions.updated"), true);
    assert.equal(published.includes("settings.updated"), true);
  });

  it("rejects permission access for an unknown project", async () => {
    const root = await mkdtemp(join(tmpdir(), "nerve-project-permissions-"));
    roots.push(root);
    const storage = await initializeStorage(root);
    stores.push(storage.canonicalStore);
    const service = new PermissionExceptionService(
      storage,
      new ProjectPermissionsRepository(storage),
      () => {
        throw new Error("Project not found");
      },
      { publish: async () => undefined } as unknown as StreamLogRegistry,
    );
    await assert.rejects(service.project("proj_missing"), /not found/i);
  });
});
