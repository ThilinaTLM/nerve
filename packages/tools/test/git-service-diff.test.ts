import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GitCommandError, GitService } from "../src/git/git-service.js";

describe("GitService fileDiff", () => {
  it("returns a path-limited staged patch", async () => {
    const calls: string[][] = [];
    const service = new GitService(() => ({ dir: "/repo", name: "repo" }));
    service.runGit = async (_cwd, args) => {
      calls.push(args);
      if (args[0] === "status") {
        return {
          stdout: "1 M. N... 100644 100644 100644 abc def src/file.ts\n",
          stderr: "",
        };
      }
      return {
        stdout: "diff --git a/src/file.ts b/src/file.ts\n+added\n",
        stderr: "",
      };
    };

    const result = await service.fileDiff(
      "proj_test",
      ".",
      "src/file.ts",
      "staged",
    );
    assert.deepEqual(calls[1], ["diff", "--staged", "-M", "--", "src/file.ts"]);
    assert.equal(result.area, "staged");
    assert.match(result.patch, /\+added/);
    assert.equal(result.binary, false);
  });

  it("includes both rename paths and detects binary patches", async () => {
    const calls: string[][] = [];
    const service = new GitService(() => ({ dir: "/repo", name: "repo" }));
    service.runGit = async (_cwd, args) => {
      calls.push(args);
      if (args[0] === "status") {
        return {
          stdout:
            "2 R. N... 100644 100644 100644 abc def R100 new.ts\told.ts\n",
          stderr: "",
        };
      }
      return {
        stdout: "Binary files a/old.ts and b/new.ts differ\n",
        stderr: "",
      };
    };

    const result = await service.fileDiff("proj_test", ".", "new.ts", "staged");
    assert.deepEqual(calls[1], [
      "diff",
      "--staged",
      "-M",
      "--",
      "old.ts",
      "new.ts",
    ]);
    assert.equal(result.renamedFrom, "old.ts");
    assert.equal(result.binary, true);
  });

  it("uses no-index output for an untracked unstaged file", async () => {
    const calls: string[][] = [];
    const service = new GitService(() => ({ dir: "/repo", name: "repo" }));
    service.runGit = async (_cwd, args) => {
      calls.push(args);
      if (args[0] === "status")
        return { stdout: "? new file.ts\n", stderr: "" };
      throw new GitCommandError(
        "git diff --no-index",
        1,
        "",
        "diff --git a/new file.ts b/new file.ts\n+new\n",
      );
    };

    const result = await service.fileDiff(
      "proj_test",
      ".",
      "new file.ts",
      "unstaged",
    );
    assert.deepEqual(calls[1], [
      "diff",
      "--no-index",
      "--",
      "/dev/null",
      "new file.ts",
    ]);
    assert.match(result.patch, /\+new/);
  });

  it("does not swallow a genuine no-index command failure", async () => {
    const service = new GitService(() => ({ dir: "/repo", name: "repo" }));
    service.runGit = async (_cwd, args) => {
      if (args[0] === "status") return { stdout: "? new.ts\n", stderr: "" };
      throw new GitCommandError("git diff --no-index", 128, "fatal");
    };

    await assert.rejects(
      () => service.fileDiff("proj_test", ".", "new.ts", "unstaged"),
      /fatal/,
    );
  });
});
