import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import type { ProjectRecord } from "@nervekit/contracts";
import { ProjectPermissionsRepository } from "../src/domains/projects/project-permissions.repository.js";
import { ProjectRepository } from "../src/domains/projects/project.repository.js";
import { SupervisionPreferencesService } from "../src/domains/tools/supervision-preferences.service.js";
import type { StreamLogRegistry } from "../src/infrastructure/events/index.js";
import { initializeStorage } from "../src/infrastructure/storage/index.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("project supervision permissions", () => {
  it("stores project grants in the host-side project directory and unions global grants", async () => {
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
    const service = new SupervisionPreferencesService(
      storage,
      repository,
      (id) => {
        const project = projects.get(id);
        if (!project) throw new Error("Project not found");
        return project;
      },
      events,
    );
    const projectGrant = {
      id: "grant_project",
      target: "command_prefix" as const,
      tokens: ["gh", "pr", "view"],
      risk: "command" as const,
    };
    const globalGrant = {
      id: "grant_global",
      target: "tool" as const,
      toolName: "web_search",
      risk: "network" as const,
    };

    await service.add("proj_one", "project", [projectGrant]);
    await service.add("proj_one", "global", [globalGrant]);

    assert.deepEqual(await service.effective("proj_one"), [
      globalGrant,
      projectGrant,
    ]);
    assert.deepEqual(await service.effective("proj_two"), [globalGrant]);
    assert.deepEqual(
      JSON.parse(
        await readFile(
          join(root, "projects", "proj_one", "permissions.json"),
          "utf8",
        ),
      ),
      { version: 1, grants: [projectGrant] },
    );
    assert.equal(published.includes("project.permissions.updated"), true);
    assert.equal(published.includes("settings.updated"), true);
  });

  it("rejects permission access for an unknown project", async () => {
    const root = await mkdtemp(join(tmpdir(), "nerve-project-permissions-"));
    roots.push(root);
    const storage = await initializeStorage(root);
    const service = new SupervisionPreferencesService(
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
