import assert from "node:assert/strict";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  executableSearchDirectories,
  locateExecutable,
  runExecutable,
} from "../../src/execution/executable/executable.js";
import { createTempProject, writeExecutable } from "../helpers.js";

describe("executable resolution", () => {
  it(
    "resolves an executable from POSIX PATH",
    { skip: process.platform === "win32" },
    async () => {
      const project = await createTempProject("nerve-executable-");
      const bin = join(project.root, "bin");
      await mkdir(bin);
      const expected = await writeExecutable(
        bin,
        "sample-command",
        'process.stdout.write("ok");',
      );

      const resolved = await locateExecutable("sample-command", {
        platform: "linux",
        env: { PATH: bin },
        homeDir: join(project.root, "home"),
      });

      assert.deepEqual(resolved, { path: expected, kind: "native" });
    },
  );

  it(
    "requires execute permission on POSIX",
    { skip: process.platform === "win32" },
    async () => {
      const project = await createTempProject("nerve-executable-mode-");
      const path = join(project.root, "not-executable");
      await writeFile(path, "content", "utf8");
      await chmod(path, 0o644);

      assert.equal(
        await locateExecutable(path, { platform: "darwin" }),
        undefined,
      );
    },
  );

  it("honors case-insensitive Windows environment keys and PATHEXT order", async () => {
    const project = await createTempProject("nerve-executable-windows-");
    const first = join(project.root, "first");
    const second = join(project.root, "second");
    await mkdir(first);
    await mkdir(second);
    const expected = join(second, "agent-browser.cmd");
    await writeFile(expected, "@echo off\r\n", "utf8");

    const resolved = await locateExecutable("agent-browser", {
      platform: "win32",
      env: { Path: `${first};${second}`, PathExt: ".CMD;.EXE" },
      homeDir: join(project.root, "home"),
    });

    assert.deepEqual(resolved, { path: expected, kind: "windows_script" });
  });

  it("adds deterministic GUI application fallback directories without duplicates", async () => {
    const directories = await executableSearchDirectories({
      platform: "darwin",
      env: { PATH: "/usr/bin:/opt/homebrew/bin" },
      homeDir: "/Users/test",
    });

    assert.equal(directories[0], "/usr/bin");
    assert.ok(directories.includes(join("/Users/test", ".local", "bin")));
    assert.ok(directories.includes(join("/Users/test", ".volta", "bin")));
    assert.ok(directories.includes("/opt/homebrew/bin"));
    assert.equal(
      directories.filter((path) => path === "/opt/homebrew/bin").length,
      1,
    );
  });

  it("runs a resolved executable and captures output", async () => {
    const project = await createTempProject("nerve-executable-run-");
    const executable = await writeExecutable(
      project.root,
      "echo-args",
      'process.stdout.write(process.argv.slice(2).join("|"));',
    );

    const result = await runExecutable(executable, ["one", "two words"], {
      timeoutMs: 2_000,
    });

    assert.equal(result.status, 0);
    assert.equal(result.stdout, "one|two words");
    assert.equal(result.timedOut, false);
    assert.equal(result.error, undefined);
  });
});
