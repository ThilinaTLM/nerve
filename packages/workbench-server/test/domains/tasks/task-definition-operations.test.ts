import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ProjectRecord } from "@nervekit/contracts/projects";
import type { TaskDefinition } from "@nervekit/contracts/task-definitions";
import { TaskDefinitionOperations } from "../../../src/domains/task-definitions/task-definition-operations.js";
import type { TaskDefinitionService } from "../../../src/domains/task-definitions/task-definition.service.js";
import type { WorkbenchTaskService } from "../../../src/domains/tasks/adapters/workbench-task-service.js";

const now = "2026-09-06T00:00:00.000Z";
const project: ProjectRecord = {
  id: "proj_task_definition_cwd",
  name: "Task definition cwd",
  dir: "/workspace/project",
  createdAt: now,
  updatedAt: now,
};

function definition(cwd?: string): TaskDefinition {
  return {
    id: "taskdef_cwd",
    scope: { kind: "project", projectId: project.id },
    command: "pnpm dev",
    cwd,
    runPolicy: "single",
    createdAt: now,
    updatedAt: now,
  };
}

describe("task definition launch working directories", () => {
  it("resolves relative cwd values from the owning project", async () => {
    const launched: Array<{ cwd: string }> = [];
    let current = definition("apps/web");
    const definitions = {
      list: async () => [current],
    } as unknown as TaskDefinitionService;
    const tasks = {
      launchDefinition: async (request: { cwd: string }) => {
        launched.push(request);
        return undefined;
      },
    } as unknown as WorkbenchTaskService;
    const operations = new TaskDefinitionOperations(definitions, tasks, () => [
      project,
    ]);

    await operations.launch(current.id);
    current = definition("/opt/web");
    await operations.launch(current.id);
    current = definition();
    await operations.launch(current.id);

    assert.deepEqual(
      launched.map((request) => request.cwd),
      ["/workspace/project/apps/web", "/opt/web", "/workspace/project"],
    );
  });

  it("uses Windows path semantics for Windows projects", async () => {
    const windowsProject = { ...project, dir: "C:\\workspace\\project" };
    const current = {
      ...definition("apps\\web"),
      scope: { kind: "project" as const, projectId: windowsProject.id },
    };
    let launchedCwd = "";
    const definitions = {
      list: async () => [current],
    } as unknown as TaskDefinitionService;
    const tasks = {
      launchDefinition: async (request: { cwd: string }) => {
        launchedCwd = request.cwd;
        return undefined;
      },
    } as unknown as WorkbenchTaskService;

    await new TaskDefinitionOperations(definitions, tasks, () => [
      windowsProject,
    ]).launch(current.id);

    assert.equal(launchedCwd, "C:\\workspace\\project\\apps\\web");
  });
});
