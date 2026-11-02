import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveBashShellConfig } from "../../src/execution/shell/shell-config.js";

const noCommand = () => ({ stdout: "", status: 1 });

describe("bash shell config resolver", () => {
  it("uses an existing custom shell path first", () => {
    assert.deepEqual(
      resolveBashShellConfig({
        shellPath: "C:\\tools\\bash.exe",
        platform: "win32",
        pathExists: (path) => path === "C:\\tools\\bash.exe",
        runCommand: noCommand,
      }),
      { shell: "C:\\tools\\bash.exe", args: ["-c"] },
    );
  });

  it("prefers Git Bash standard locations on Windows", () => {
    assert.deepEqual(
      resolveBashShellConfig({
        platform: "win32",
        env: {
          ProgramFiles: "C:\\Program Files",
          "ProgramFiles(x86)": "C:\\Program Files (x86)",
        },
        pathExists: (path) => path === "C:\\Program Files\\Git\\bin\\bash.exe",
        runCommand: noCommand,
      }),
      { shell: "C:\\Program Files\\Git\\bin\\bash.exe", args: ["-c"] },
    );
  });

  it("falls back to bash.exe on PATH on Windows", () => {
    assert.deepEqual(
      resolveBashShellConfig({
        platform: "win32",
        env: {},
        pathExists: (path) => path === "D:\\msys64\\usr\\bin\\bash.exe",
        runCommand: (command, args) => {
          assert.equal(command, "where");
          assert.deepEqual(args, ["bash.exe"]);
          return { stdout: "D:\\msys64\\usr\\bin\\bash.exe\r\n", status: 0 };
        },
      }),
      { shell: "D:\\msys64\\usr\\bin\\bash.exe", args: ["-c"] },
    );
  });

  it("finds per-user Git installations", () => {
    const shell =
      "C:\\Users\\dev\\AppData\\Local\\Programs\\Git\\bin\\bash.exe";
    assert.equal(
      resolveBashShellConfig({
        platform: "win32",
        env: { LOCALAPPDATA: "C:\\Users\\dev\\AppData\\Local" },
        pathExists: (path) => path === shell,
        runCommand: noCommand,
      }).shell,
      shell,
    );
  });

  for (const directory of ["cmd", "bin"]) {
    for (const bashDirectory of ["bin", "usr\\bin"]) {
      it(`derives Git root from ${directory}/git.exe for ${bashDirectory}`, () => {
        const git = `D:\\Portable Git\\${directory}\\git.exe`;
        const shell = `D:\\Portable Git\\${bashDirectory}\\bash.exe`;
        assert.equal(
          resolveBashShellConfig({
            platform: "win32",
            env: {},
            pathExists: (path) => path === git || path === shell,
            runCommand: (command, args) => {
              assert.equal(command, "where");
              return args[0] === "git.exe"
                ? { stdout: `${git}\r\n`, status: 0 }
                : { stdout: "", status: 1 };
            },
          }).shell,
          shell,
        );
      });
    }
  }

  it("skips WSL and missing PATH entries to find a later bash", () => {
    const shell = "D:\\msys64\\usr\\bin\\bash.exe";
    assert.equal(
      resolveBashShellConfig({
        platform: "win32",
        env: { SystemRoot: "C:\\Windows" },
        pathExists: (path) => path !== "D:\\missing\\bash.exe",
        runCommand: () => ({
          stdout: `c:\\WINDOWS\\system32\\bash.exe\r\nD:\\missing\\bash.exe\r\n${shell}\r\n`,
          status: 0,
        }),
      }).shell,
      shell,
    );
  });

  it("does not use the WSL launcher as an automatic fallback", () => {
    assert.throws(
      () =>
        resolveBashShellConfig({
          platform: "win32",
          env: { WINDIR: "C:\\Windows" },
          pathExists: () => true,
          runCommand: (_command, args) =>
            args[0] === "bash.exe"
              ? { stdout: "C:\\Windows\\System32\\bash.exe", status: 0 }
              : { stdout: "", status: 1 },
        }),
      /No bash shell found/,
    );
    assert.equal(
      resolveBashShellConfig({
        platform: "win32",
        shellPath: "C:\\Windows\\System32\\bash.exe",
        pathExists: () => true,
        runCommand: noCommand,
      }).shell,
      "C:\\Windows\\System32\\bash.exe",
    );
  });

  it("throws an actionable error when Windows bash is missing", () => {
    assert.throws(
      () =>
        resolveBashShellConfig({
          platform: "win32",
          env: { ProgramFiles: "C:\\Program Files" },
          pathExists: () => false,
          runCommand: noCommand,
        }),
      /No bash shell found.*Git for Windows/s,
    );
  });

  it("uses /bin/bash on Unix when present", () => {
    assert.deepEqual(
      resolveBashShellConfig({
        platform: "linux",
        pathExists: (path) => path === "/bin/bash",
        runCommand: noCommand,
      }),
      { shell: "/bin/bash", args: ["-c"] },
    );
  });

  it("falls back to bash on PATH then sh on Unix", () => {
    assert.deepEqual(
      resolveBashShellConfig({
        platform: "linux",
        pathExists: () => false,
        runCommand: () => ({ stdout: "/usr/local/bin/bash\n", status: 0 }),
      }),
      { shell: "/usr/local/bin/bash", args: ["-c"] },
    );
    assert.deepEqual(
      resolveBashShellConfig({
        platform: "linux",
        pathExists: () => false,
        runCommand: noCommand,
      }),
      { shell: "sh", args: ["-c"] },
    );
  });

  it("prefers a PATH bash over /bin/bash on macOS", () => {
    assert.deepEqual(
      resolveBashShellConfig({
        platform: "darwin",
        pathExists: () => true,
        runCommand: () => ({
          stdout: "/bin/bash\n/opt/homebrew/bin/bash\n",
          status: 0,
        }),
      }),
      { shell: "/opt/homebrew/bin/bash", args: ["-c"] },
    );
    assert.deepEqual(
      resolveBashShellConfig({
        platform: "darwin",
        pathExists: (path) => path === "/bin/bash",
        runCommand: () => ({ stdout: "/bin/bash\n", status: 0 }),
      }),
      { shell: "/bin/bash", args: ["-c"] },
    );
  });
});
