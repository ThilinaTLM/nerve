import assert from "node:assert/strict";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { ProjectRecord } from "@nervekit/contracts";
import type { ResolvedExecutable } from "@nervekit/tools";
import { ProjectTerminalService } from "../src/domains/projects/project-terminal.service.js";

function childProcessStub(): ChildProcess {
  const child = new EventEmitter() as ChildProcess;
  child.unref = () => child;
  return child;
}

function projectAt(dir: string): ProjectRecord {
  return {
    id: "proj_terminal",
    name: "Terminal project",
    dir,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function executable(path: string): ResolvedExecutable {
  return { path, kind: "native" };
}

describe("ProjectTerminalService", () => {
  it("prefers xdg-terminal-exec and launches nested directories as cwd", async () => {
    const root = await mkdtemp(join(tmpdir(), "nerve-terminal-test-"));
    await mkdir(join(root, "src"));
    const launches: Array<{
      command: ResolvedExecutable | string;
      args: string[];
      options: SpawnOptions;
    }> = [];
    const service = new ProjectTerminalService(() => projectAt(root), {
      platform: "linux",
      locate: async (command) =>
        command === "xdg-terminal-exec"
          ? executable("/usr/bin/xdg-terminal-exec")
          : undefined,
      spawnCommand: (command, args, options) => {
        launches.push({ command, args, options });
        return childProcessStub();
      },
    });
    try {
      assert.deepEqual(await service.refresh(), {
        available: true,
        source: "path",
        executable: "/usr/bin/xdg-terminal-exec",
      });
      assert.deepEqual(
        await service.openProject("proj_terminal", { path: "src" }),
        { projectId: "proj_terminal", dir: join(root, "src") },
      );
      assert.deepEqual(launches[0]?.args, []);
      assert.equal(launches[0]?.options.cwd, join(root, "src"));
      assert.equal(launches[0]?.options.detached, true);
      assert.equal(launches[0]?.options.windowsHide, true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("builds macOS and Windows system terminal launches", async () => {
    const root = await mkdtemp(join(tmpdir(), "nerve-terminal-platform-"));
    const launches: Array<{ args: string[]; options: SpawnOptions }> = [];
    const spawnCommand = (
      _command: ResolvedExecutable | string,
      args: string[],
      options: SpawnOptions,
    ) => {
      launches.push({ args, options });
      return childProcessStub();
    };
    try {
      const mac = new ProjectTerminalService(() => projectAt(root), {
        platform: "darwin",
        locate: async (command) =>
          command === "/usr/bin/open" ? executable("/usr/bin/open") : undefined,
        spawnCommand,
      });
      await mac.openProject("proj_terminal", {});
      assert.deepEqual(launches[0]?.args, ["-a", "Terminal", root]);

      const windows = new ProjectTerminalService(() => projectAt(root), {
        platform: "win32",
        comspec: "C:\\Windows\\System32\\cmd.exe",
        locate: async () => undefined,
        spawnCommand,
      });
      await windows.openProject("proj_terminal", {});
      assert.deepEqual(launches[1]?.args, ["/K"]);
      assert.equal(launches[1]?.options.windowsHide, false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reports unavailable launchers and rejects file targets", async () => {
    const root = await mkdtemp(join(tmpdir(), "nerve-terminal-invalid-"));
    await writeFile(join(root, "file.txt"), "");
    const service = new ProjectTerminalService(() => projectAt(root), {
      platform: "linux",
      locate: async () => undefined,
    });
    try {
      assert.equal((await service.refresh()).available, false);
      await assert.rejects(
        service.openProject("proj_terminal", { path: "file.txt" }),
        /must be a directory/,
      );
      await assert.rejects(
        service.openProject("proj_terminal", {}),
        /not available/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
