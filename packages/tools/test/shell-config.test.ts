import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveBashShellConfig } from "../src/execution/index.js";

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
});
