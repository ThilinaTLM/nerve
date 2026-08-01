import assert from "node:assert/strict";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { describe, it } from "node:test";
import type { ProjectRecord } from "@nervekit/contracts";
import type { ResolvedExecutable } from "@nervekit/tools";
import { ProjectEditorService } from "../src/domains/projects/project-editor.service.js";

const project: ProjectRecord = {
  id: "proj_editor",
  name: "Editor project",
  dir: "/workspace/project with spaces",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function childProcessStub(): ChildProcess {
  const child = new EventEmitter() as ChildProcess;
  child.unref = () => child;
  return child;
}

describe("ProjectEditorService", () => {
  it("reports and launches a located editor", async () => {
    const code: ResolvedExecutable = {
      path: "C:\\Users\\test\\AppData\\Roaming\\npm\\code.cmd",
      kind: "windows_script",
    };
    const launches: Array<{
      command: ResolvedExecutable | string;
      args: string[];
      options: SpawnOptions;
    }> = [];
    const service = new ProjectEditorService(() => project, {
      locate: async (command) => (command === "code" ? code : undefined),
      spawnCommand: (command, args, options) => {
        launches.push({ command, args, options });
        return childProcessStub();
      },
    });

    const statuses = await service.refresh();
    assert.deepEqual(statuses.vscode, {
      available: true,
      source: "path",
      executable: code.path,
    });
    assert.equal(statuses.zed.available, false);

    assert.deepEqual(await service.openProject(project.id, "vscode"), {
      projectId: project.id,
      editor: "vscode",
      dir: project.dir,
    });
    assert.equal(launches.length, 1);
    assert.deepEqual(launches[0]?.command, code);
    assert.deepEqual(launches[0]?.args, [project.dir]);
    assert.equal(launches[0]?.options.detached, true);
    assert.equal(launches[0]?.options.windowsHide, true);
    assert.equal(launches[0]?.options.stdio, "ignore");
  });

  it("returns unavailable statuses and rejects an unavailable editor", async () => {
    const service = new ProjectEditorService(() => project, {
      locate: async () => undefined,
    });

    const statuses = await service.refresh();
    assert.equal(statuses.vscode.available, false);
    assert.match(statuses.vscode.error ?? "", /launcher not found/);
    await assert.rejects(
      service.openProject(project.id, "vscode"),
      (error: unknown) =>
        error instanceof Error && error.message.includes("not available"),
    );
  });
});
