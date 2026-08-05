import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { GitService } from "../src/git/git-service.js";

const status = [
  "? new.ts",
  "1 .M N... 100644 100644 100644 abc def modified.ts",
].join("\n");

describe("GitService project file status", () => {
  it("returns project-relative paths for a root repository", async () => {
    const service = new GitService(() => ({ dir: "/repo", name: "repo" }));
    service.isRepo = async () => true;
    service.runGit = async (_cwd, args) => {
      assert.deepEqual(args, ["status", "--porcelain=v2"]);
      return { stdout: status, stderr: "" };
    };

    const result = await service.projectFileStatus("proj_test");
    assert.deepEqual(
      result.files.map((file) => [file.repo, file.path]),
      [
        [".", "modified.ts"],
        [".", "new.ts"],
      ],
    );
  });

  it("prefixes paths from nested repositories", async () => {
    const root = await mkdtemp(join(tmpdir(), "nerve-git-status-"));
    try {
      await mkdir(join(root, "packages", "app", ".git"), { recursive: true });
      const service = new GitService(() => ({ dir: root, name: "project" }));
      service.isRepo = async () => false;
      service.runGit = async (cwd, args) => {
        assert.equal(cwd, join(root, "packages", "app"));
        assert.deepEqual(args, ["status", "--porcelain=v2"]);
        return { stdout: "? src/index.ts", stderr: "" };
      };

      const result = await service.projectFileStatus("proj_test");
      assert.equal(result.files[0]?.repo, "packages/app");
      assert.equal(result.files[0]?.path, "packages/app/src/index.ts");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
