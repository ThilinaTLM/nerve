import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { GitCommandError, runGitCommand } from "../../src/git/git-command.js";

describe("Rust-hosted Git command execution", () => {
  it("captures successful UTF-8 output", async () => {
    const result = await runGitCommand("git", process.cwd(), [
      "-c",
      "alias.nerve-echo=!printf 'héllo\\n'",
      "nerve-echo",
    ]);
    assert.equal(result.stdout, "héllo\n");
    assert.equal(result.stderr, "");
  });

  it("preserves stdout and stderr for non-zero exits", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nerve-git-command-"));
    try {
      await writeFile(join(dir, "left"), "left\n");
      await writeFile(join(dir, "right"), "right\n");
      await assert.rejects(
        runGitCommand("git", dir, ["diff", "--no-index", "left", "right"]),
        (error: unknown) => {
          assert.ok(error instanceof GitCommandError);
          assert.equal(error.code, 1);
          assert.match(error.stdout, /^diff --git /);
          return true;
        },
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("maps startup failures to a stable command error", async () => {
    await assert.rejects(
      runGitCommand("git", join(process.cwd(), "does-not-exist"), ["status"]),
      (error: unknown) => {
        assert.ok(error instanceof GitCommandError);
        assert.equal(error.code, null);
        return true;
      },
    );
  });
});
