import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import type { ProjectRecord } from "@nervekit/contracts";
import { ProjectPermissionsRepository } from "../src/domains/permissions/project-permissions.repository.js";
import { ProjectRepository } from "../src/domains/projects/project.repository.js";
import { PermissionExceptionService } from "../src/domains/permissions/permission-exceptions.service.js";
import type { StreamLogRegistry } from "../src/infrastructure/events/index.js";
import { initializeStorage } from "../src/infrastructure/storage/index.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("project permission exceptions", () => {
  it("stores project exceptions in the host-side project directory and unions user exceptions", async () => {
    const root = await mkdtemp(join(tmpdir(), "nerve-project-permissions-"));
    roots.push(root);
    const storage = await initializeStorage(root);
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

    assert.deepEqual(await service.effective("proj_one"), [
      userException,
      projectException,
    ]);
    assert.deepEqual(await service.effective("proj_two"), [userException]);
    assert.deepEqual(
      JSON.parse(
        await readFile(
          join(root, "projects", "proj_one", "permissions.json"),
          "utf8",
        ),
      ),
      { version: 2, exceptions: [projectException] },
    );
    assert.equal(published.includes("project.permissions.updated"), true);
    assert.equal(published.includes("settings.updated"), true);
  });

  it("rejects permission access for an unknown project", async () => {
    const root = await mkdtemp(join(tmpdir(), "nerve-project-permissions-"));
    roots.push(root);
    const storage = await initializeStorage(root);
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
