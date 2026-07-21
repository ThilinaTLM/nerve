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
  it("reuses one porcelain status command and caches stable metadata", async () => {
    const calls: string[][] = [];
    let now = 1_000;
    const overviewObservations: Array<{
      durationMs: number;
      succeeded: boolean;
    }> = [];
    const service = new GitService(() => ({ dir: "/repo", name: "repo" }), {
      now: () => now,
      stableMetadataTtlMs: 30_000,
      onOverviewCompleted: (observation) =>
        overviewObservations.push(observation),
    });
    service.runGit = async (_cwd, args) => {
      calls.push(args);
      const command = args.join(" ");
      if (command === "status --porcelain=v2 --branch") {
        return { stdout: status, stderr: "" };
      }
      if (
        command ===
        "for-each-ref --format=%(refname)%00%(symref) refs/heads refs/remotes/origin"
      ) {
        return {
          stdout: [
            "refs/heads/feature\u0000",
            "refs/heads/main\u0000",
            "refs/remotes/origin/HEAD\u0000refs/remotes/origin/main",
            "refs/remotes/origin/main\u0000",
          ].join("\n"),
          stderr: "",
        };
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
    await service.overview("proj_test", ".");
    assert.equal(calls.filter((args) => args[0] === "status").length, 2);
    assert.equal(calls.filter((args) => args[0] === "for-each-ref").length, 1);
    assert.equal(calls.filter((args) => args[0] === "remote").length, 1);
    assert.equal(calls.filter((args) => args[0] === "rev-parse").length, 0);
    assert.equal(overview.repo.currentBranch, "feature");
    assert.equal(overview.repo.baseBranch, "main");
    assert.equal(overview.untrackedCount, 1);
    assert.equal(overview.insertions, 2);
    assert.equal(overview.recentCommits.length, 1);

    now += 30_001;
    await service.overview("proj_test", ".");
    assert.equal(calls.filter((args) => args[0] === "for-each-ref").length, 2);
    service.invalidateStableRepoMetadata(
      service.resolveRepoDir("proj_test", "."),
    );
    await service.overview("proj_test", ".");
    assert.equal(calls.filter((args) => args[0] === "for-each-ref").length, 3);
    assert.equal(overviewObservations.length, 4);
    assert.equal(
      overviewObservations.every(
        (observation) => observation.succeeded && observation.durationMs >= 0,
      ),
      true,
    );
  });

  it("reports bounded command diagnostics without affecting execution", async () => {
    const observations: unknown[] = [];
    const service = new GitService(
      () => ({ dir: process.cwd(), name: "repo" }),
      {
        onCommandCompleted: (observation) => {
          observations.push(observation);
          throw new Error("diagnostic failure");
        },
      },
    );

    const result = await service.run("git", process.cwd(), ["--version"]);
    assert.match(result.stdout, /^git version /);
    assert.deepEqual(
      observations.map((observation) => Object.keys(observation as object)),
      [["bin", "command", "durationMs", "succeeded"]],
    );
  });
});
