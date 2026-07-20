import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GitCommandError, GitService } from "../src/git/git-service.js";

const status = [
  "# branch.oid abcdef",
  "# branch.head feature",
  "# branch.upstream origin/feature",
  "# branch.ab +1 -2",
  "? new-file.ts",
].join("\n");

describe("GitService overview snapshots", () => {
  it("reuses one porcelain status command", async () => {
    const calls: string[][] = [];
    const service = new GitService(() => ({ dir: "/repo", name: "repo" }));
    service.runGit = async (_cwd, args) => {
      calls.push(args);
      const command = args.join(" ");
      if (command === "status --porcelain=v2 --branch") {
        return { stdout: status, stderr: "" };
      }
      if (command === "symbolic-ref --quiet refs/remotes/origin/HEAD") {
        return { stdout: "refs/remotes/origin/main\n", stderr: "" };
      }
      if (command === "remote -v") {
        return {
          stdout: "origin\thttps://github.com/example/repo.git (fetch)\n",
          stderr: "",
        };
      }
      if (command === "diff --shortstat") {
        return {
          stdout: " 1 file changed, 2 insertions(+), 1 deletion(-)",
          stderr: "",
        };
      }
      if (command === "diff --staged --shortstat") {
        return { stdout: "", stderr: "" };
      }
      if (command.startsWith("log ")) {
        return {
          stdout: "abc123\u0000message\u00002 minutes ago\n",
          stderr: "",
        };
      }
      if (command.startsWith("rev-parse --verify --quiet")) {
        return { stdout: "abcdef\n", stderr: "" };
      }
      if (
        command === "merge-base --is-ancestor HEAD refs/remotes/origin/main"
      ) {
        throw new GitCommandError(command, 1, "not merged");
      }
      throw new Error(`Unexpected git command: ${command}`);
    };

    const overview = await service.overview("proj_test", ".");
    assert.equal(calls.filter((args) => args[0] === "status").length, 1);
    assert.equal(overview.repo.currentBranch, "feature");
    assert.equal(overview.untrackedCount, 1);
    assert.equal(overview.insertions, 2);
    assert.equal(overview.recentCommits.length, 1);
  });
});
