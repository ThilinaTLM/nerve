import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { GitCommandError, GitService } from "../src/git/git-service.js";

async function withRepo(
  run: (repoDir: string, service: GitService) => Promise<void>,
): Promise<void> {
  const repoDir = await mkdtemp(join(tmpdir(), "nerve-git-diff-"));
  const service = new GitService(() => ({ dir: repoDir, name: "repo" }));
  try {
    await run(repoDir, service);
  } finally {
    await rm(repoDir, { recursive: true, force: true });
  }
}

describe("GitService fileDiff", () => {
  it("returns complete HEAD and index documents for a staged file", async () => {
    await withRepo(async (_repoDir, service) => {
      const calls: string[][] = [];
      service.runGit = async (_cwd, args) => {
        calls.push(args);
        if (args[0] === "status") {
          return {
            stdout: "1 M. N... 100644 100644 100644 abc def src/file.ts\n",
            stderr: "",
          };
        }
        if (args[0] === "diff") {
          return { stdout: "1\t1\tsrc/file.ts\n", stderr: "" };
        }
        if (args[1] === "HEAD:src/file.ts") {
          return { stdout: "before\n", stderr: "" };
        }
        if (args[1] === ":src/file.ts") {
          return { stdout: "after\n", stderr: "" };
        }
        throw new Error(`Unexpected git call: ${args.join(" ")}`);
      };

      const result = await service.fileDiff(
        "proj_test",
        ".",
        "src/file.ts",
        "staged",
      );

      assert.deepEqual(calls[1], [
        "diff",
        "--staged",
        "--numstat",
        "-M",
        "--",
        "src/file.ts",
      ]);
      assert.deepEqual(result, {
        path: "src/file.ts",
        area: "staged",
        binary: false,
        original: "before\n",
        modified: "after\n",
      });
    });
  });

  it("returns index and working-tree documents for an unstaged file", async () => {
    await withRepo(async (repoDir, service) => {
      await writeFile(join(repoDir, "file.ts"), "working tree\n");
      service.runGit = async (_cwd, args) => {
        if (args[0] === "status") {
          return {
            stdout: "1 .M N... 100644 100644 100644 abc def file.ts\n",
            stderr: "",
          };
        }
        if (args[0] === "diff") {
          return { stdout: "1\t1\tfile.ts\n", stderr: "" };
        }
        if (args[1] === ":file.ts") {
          return { stdout: "index\n", stderr: "" };
        }
        throw new Error(`Unexpected git call: ${args.join(" ")}`);
      };

      const result = await service.fileDiff(
        "proj_test",
        ".",
        "file.ts",
        "unstaged",
      );

      assert.deepEqual(result, {
        path: "file.ts",
        area: "unstaged",
        binary: false,
        original: "index\n",
        modified: "working tree\n",
      });
    });
  });

  it("uses an empty original document for a staged addition", async () => {
    await withRepo(async (_repoDir, service) => {
      const showSpecs: string[] = [];
      service.runGit = async (_cwd, args) => {
        if (args[0] === "status") {
          return {
            stdout: "1 A. N... 000000 100644 100644 000 def new.ts\n",
            stderr: "",
          };
        }
        if (args[0] === "diff") {
          return { stdout: "2\t0\tnew.ts\n", stderr: "" };
        }
        showSpecs.push(args[1] ?? "");
        return { stdout: "new file\n", stderr: "" };
      };

      const result = await service.fileDiff(
        "proj_test",
        ".",
        "new.ts",
        "staged",
      );

      assert.deepEqual(showSpecs, [":new.ts"]);
      assert.equal(result.binary, false);
      if (!result.binary) {
        assert.equal(result.original, "");
        assert.equal(result.modified, "new file\n");
      }
    });
  });

  it("uses an empty modified document for a staged deletion", async () => {
    await withRepo(async (_repoDir, service) => {
      service.runGit = async (_cwd, args) => {
        if (args[0] === "status") {
          return {
            stdout: "1 D. N... 100644 000000 000000 abc 000 old.ts\n",
            stderr: "",
          };
        }
        if (args[0] === "diff") {
          return { stdout: "0\t2\told.ts\n", stderr: "" };
        }
        assert.equal(args[1], "HEAD:old.ts");
        return { stdout: "old file\n", stderr: "" };
      };

      const result = await service.fileDiff(
        "proj_test",
        ".",
        "old.ts",
        "staged",
      );

      assert.equal(result.binary, false);
      if (!result.binary) {
        assert.equal(result.original, "old file\n");
        assert.equal(result.modified, "");
      }
    });
  });

  it("selects old and new paths for a staged rename", async () => {
    await withRepo(async (_repoDir, service) => {
      const calls: string[][] = [];
      service.runGit = async (_cwd, args) => {
        calls.push(args);
        if (args[0] === "status") {
          return {
            stdout:
              "2 R. N... 100644 100644 100644 abc def R090 new.ts\told.ts\n",
            stderr: "",
          };
        }
        if (args[0] === "diff") {
          return { stdout: "1\t1\told.ts => new.ts\n", stderr: "" };
        }
        if (args[1] === "HEAD:old.ts") {
          return { stdout: "old\n", stderr: "" };
        }
        if (args[1] === ":new.ts") {
          return { stdout: "new\n", stderr: "" };
        }
        throw new Error(`Unexpected git call: ${args.join(" ")}`);
      };

      const result = await service.fileDiff(
        "proj_test",
        ".",
        "new.ts",
        "staged",
      );

      assert.deepEqual(calls[1], [
        "diff",
        "--staged",
        "--numstat",
        "-M",
        "--",
        "old.ts",
        "new.ts",
      ]);
      assert.deepEqual(result, {
        path: "new.ts",
        renamedFrom: "old.ts",
        area: "staged",
        binary: false,
        original: "old\n",
        modified: "new\n",
      });
    });
  });

  it("returns binary metadata without reading either document", async () => {
    await withRepo(async (_repoDir, service) => {
      const calls: string[][] = [];
      service.runGit = async (_cwd, args) => {
        calls.push(args);
        if (args[0] === "status") {
          return {
            stdout: "1 M. N... 100644 100644 100644 abc def image.png\n",
            stderr: "",
          };
        }
        return { stdout: "-\t-\timage.png\n", stderr: "" };
      };

      const result = await service.fileDiff(
        "proj_test",
        ".",
        "image.png",
        "staged",
      );

      assert.equal(calls.length, 2);
      assert.deepEqual(result, {
        path: "image.png",
        area: "staged",
        binary: true,
      });
    });
  });

  it("uses an empty original and worktree content for an untracked file", async () => {
    await withRepo(async (repoDir, service) => {
      await writeFile(join(repoDir, "new file.ts"), "new\n");
      const calls: string[][] = [];
      service.runGit = async (_cwd, args) => {
        calls.push(args);
        if (args[0] === "status") {
          return { stdout: "? new file.ts\n", stderr: "" };
        }
        throw new GitCommandError(
          "git diff --no-index",
          1,
          "",
          "1\t0\t/dev/null => new file.ts\n",
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
        "--numstat",
        "--",
        "/dev/null",
        "new file.ts",
      ]);
      assert.equal(result.binary, false);
      if (!result.binary) {
        assert.equal(result.original, "");
        assert.equal(result.modified, "new\n");
      }
    });
  });

  it("does not swallow a genuine no-index command failure", async () => {
    await withRepo(async (_repoDir, service) => {
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

  it("rejects worktree paths outside the repository", async () => {
    await withRepo(async (_repoDir, service) => {
      service.runGit = async (_cwd, args) => {
        if (args[0] === "status") return { stdout: "", stderr: "" };
        if (args[0] === "diff")
          return { stdout: "1\t1\t../outside.ts\n", stderr: "" };
        if (args[0] === "show") return { stdout: "index\n", stderr: "" };
        throw new Error(`Unexpected git call: ${args.join(" ")}`);
      };

      await assert.rejects(
        () => service.fileDiff("proj_test", ".", "../outside.ts", "unstaged"),
        /outside the repository directory/,
      );
    });
  });
});
