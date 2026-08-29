import assert from "node:assert/strict";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { ProjectRecord } from "@nervekit/contracts";
import type { ResolvedExecutable } from "@nervekit/tools";
import { ProjectEditorService } from "../../../src/domains/projects/project-editor.service.js";

function projectAt(dir: string): ProjectRecord {
  return {
    id: "proj_editor",
    name: "Editor project",
    dir,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function childProcessStub(): ChildProcess {
  const child = new EventEmitter() as ChildProcess;
  child.unref = () => child;
  return child;
}

describe("ProjectEditorService", () => {
  it("reports and launches a located editor at root and nested targets", async () => {
    const root = await mkdtemp(join(tmpdir(), "nerve-editor-test-"));
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "main file.ts"), "export {};\n");
    const project = projectAt(root);
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

    try {
      const statuses = await service.refresh();
      assert.deepEqual(statuses.vscode, {
        available: true,
        source: "path",
        executable: code.path,
      });
      assert.equal(statuses.zed.available, false);

      assert.deepEqual(
        await service.openProject(project.id, { editor: "vscode" }),
        { projectId: project.id, editor: "vscode", path: root },
      );
      assert.deepEqual(
        await service.openProject(project.id, {
          editor: "vscode",
          path: "src/main file.ts",
        }),
        {
          projectId: project.id,
          editor: "vscode",
          path: join(root, "src", "main file.ts"),
        },
      );
      assert.deepEqual(launches[0]?.command, code);
      assert.deepEqual(launches[0]?.args, [root]);
      assert.deepEqual(launches[1]?.args, [join(root, "src", "main file.ts")]);
      assert.equal(launches[0]?.options.detached, true);
      assert.equal(launches[0]?.options.windowsHide, true);
      assert.equal(launches[0]?.options.stdio, "ignore");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns unavailable statuses and rejects an unavailable editor", async () => {
    const project = projectAt("/workspace/project with spaces");
    const service = new ProjectEditorService(() => project, {
      locate: async () => undefined,
    });

    const statuses = await service.refresh();
    assert.equal(statuses.vscode.available, false);
    assert.match(statuses.vscode.error ?? "", /launcher not found/);
    await assert.rejects(
      service.openProject(project.id, { editor: "vscode" }),
      (error: unknown) =>
        error instanceof Error && error.message.includes("not available"),
    );
  });
});
