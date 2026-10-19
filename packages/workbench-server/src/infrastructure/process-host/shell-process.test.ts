import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveProcessShell, spawnShellProcess } from "./shell-process.js";

void test("login shells retain project environment activation", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "nerve-login-env-"));
  try {
    const direnv = join(
      cwd,
      process.platform === "win32" ? "direnv.exe" : "direnv",
    );
    await writeFile(direnv, "fixture", { mode: 0o755 });
    await writeFile(join(cwd, ".envrc"), "export PROJECT_ENV=active");
    const invocation = resolveProcessShell("echo hello", {
      cwd,
      login: true,
      shellPath: process.execPath,
      env: { PATH: cwd },
    });
    assert.equal(invocation.shell, direnv);
    assert.deepEqual(invocation.args, [
      "exec",
      cwd,
      process.execPath,
      "-lc",
      "echo hello",
    ]);
    assert.equal(invocation.env.GIT_TERMINAL_PROMPT, "0");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

void test("Windows login shells select Git Bash and preserve login arguments and environment", () => {
  const shell = resolveProcessShell(
    "echo hello",
    {
      cwd: ".",
      login: true,
      env: { ProgramFiles: "C:\\Programs", EXAMPLE: "value" },
    },
    {
      platform: "win32",
      pathExists: (path) => path === "C:\\Programs\\Git\\bin\\bash.exe",
      runCommand: () => {
        throw new Error("PATH lookup should not be needed");
      },
    },
  );
  assert.equal(shell.shell, "C:\\Programs\\Git\\bin\\bash.exe");
  assert.deepEqual(shell.args, ["-lc", "echo hello"]);
  assert.equal(shell.env.EXAMPLE, "value");
});

void test("Windows login shells resolve PATH and explicit settings without a POSIX fallback", () => {
  const resolution = {
    platform: "win32" as const,
    pathExists: (path: string) => path === "D:\\bash.exe",
    runCommand: (command: string, args: string[]) => {
      assert.equal(command, "where");
      assert.deepEqual(args, ["bash.exe"]);
      return { stdout: "D:\\bash.exe\r\n", status: 0 };
    },
  };
  assert.equal(
    resolveProcessShell("pwd", { cwd: ".", login: true }, resolution).shell,
    "D:\\bash.exe",
  );
  assert.equal(
    resolveProcessShell(
      "pwd",
      { cwd: ".", login: true, shellPath: " D:\\bash.exe " },
      resolution,
    ).shell,
    "D:\\bash.exe",
  );
  assert.throws(
    () =>
      resolveProcessShell(
        "pwd",
        { cwd: ".", login: true },
        {
          platform: "win32",
          pathExists: () => false,
          runCommand: () => ({ stdout: "", status: 1 }),
        },
      ),
    /No bash shell found.*Git for Windows/s,
  );
});

void test("native synchronous spawn failures retain their cause and launch context without command disclosure", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nerve-launch-error-"));
  try {
    const cwd = join(dir, "missing-directory");
    assert.throws(
      () =>
        spawnShellProcess("PRIVATE_SUBMITTED_COMMAND", {
          cwd,
          shellPath: process.execPath,
          policy: {},
        }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(error.cause instanceof Error);
        assert.match(error.message, /Shell process spawn failed/);
        assert.ok(error.message.includes(cwd));
        assert.doesNotMatch(error.message, /PRIVATE_SUBMITTED_COMMAND/);
        if ("code" in error.cause)
          assert.equal((error as NodeJS.ErrnoException).code, error.cause.code);
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
