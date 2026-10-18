import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GitOverviewObservation } from "../../src/git/git-observability.js";
import { GitService } from "../../src/git/git-service.js";

describe("GitService overview snapshots", () => {
  it("coalesces whole overview demand and derives metadata without an extra status snapshot", async (context) => {
    const root = await mkdtemp(join(tmpdir(), "nerve-overview-coalescing-"));
    await mkdir(join(root, ".git"));
    const calls: string[][] = [];
    let now = 1_000;
    let snapshotCalls = 0;
    const overviewObservations: GitOverviewObservation[] = [];
    const service = new GitService(() => ({ dir: root, name: "repo" }), {
      now: () => now,
      stableMetadataTtlMs: 30_000,
      onOverviewCompleted: (observation) =>
        overviewObservations.push(observation),
      readBackend: {
        async close() {},
        discoverProject: async (root) => ({
          root,
          projectIsRepo: true,
          repositories: [],
        }),
        projectSnapshots: async () => [],
        isRepository: async () => true,
        fileDiff: async () => {
          throw new Error("not used");
        },
        metadata: (repoDir) => service.readSnapshot(repoDir),
        snapshot: async () => {
          snapshotCalls += 1;
          return {
            headOid: "abcdef",
            branch: {
              head: "feature",
              detached: false,
              upstream: "origin/feature",
              ahead: 1,
              behind: 2,
            },
            refs: [
              { name: "refs/heads/feature", target: "abcdef" },
              { name: "refs/heads/main", target: "123456" },
              {
                name: "refs/remotes/origin/HEAD",
                symbolicTarget: "refs/remotes/origin/main",
              },
              { name: "refs/remotes/origin/main", target: "123456" },
            ],
            remotes: [
              {
                name: "origin",
                fetchUrl: "https://github.com/example/repo.git",
              },
            ],
            files: [
              {
                path: "new-file.ts",
                index: "?",
                worktree: "?",
                staged: false,
                untracked: true,
              },
            ],
            recentCommits: [
              {
                hash: "abc123",
                subject: "message",
                relativeDate: "2 minutes ago",
              },
            ],
            stashes: [],
          };
        },
        isAncestor: async () => false,
        resolveRevision: async (_repoDir, revision) => revision,
        validateBranchName: async () => true,
      },
    });
    // This test isolates snapshot reuse; filesystem containment has its own fixtures.
    service.resolveRepoDir = () => root;
    context.after(async () => {
      await service.closeRemoteCaches();
      await rm(root, { recursive: true, force: true });
    });
    service.runGit = async (_cwd, args) => {
      calls.push(args);
      const command = args.join(" ");
      if (command === "diff --shortstat") {
        return {
          stdout: " 1 file changed, 2 insertions(+), 1 deletion(-)",
          stderr: "",
        };
      }
      if (command === "diff --staged --shortstat") {
        return { stdout: "", stderr: "" };
      }
      throw new Error(`Unexpected git command: ${command}`);
    };

    const first = service.overview("proj_test", ".");
    const joined = service.overview("proj_test", ".");
    assert.equal(
      first,
      joined,
      "concurrent or retried client demand joins the whole detailed RPC, including CLI diffs",
    );
    service.invalidateProjectReads("proj_test", { uncertain: true });
    const overview = await first;
    assert.equal(overview.stale, true);
    const fresh = await service.overview("proj_test", ".");
    assert.equal(fresh.stale, undefined);
    assert.equal(snapshotCalls, 2);
    assert.equal(calls.filter((args) => args[0] === "diff").length, 4);
    assert.equal(overview.repo.currentBranch, "feature");
    assert.equal(overview.repo.baseBranch, "main");
    assert.equal(overview.untrackedCount, 1);
    assert.equal(overview.insertions, 2);
    assert.equal(overview.recentCommits.length, 1);
    assert.deepEqual(overview.stashes, []);

    now += 30_001;
    await service.overview("proj_test", ".");
    assert.equal(snapshotCalls, 3);
    service.invalidateStableRepoMetadata(
      service.resolveRepoDir("proj_test", "."),
    );
    await service.overview("proj_test", ".");
    assert.equal(snapshotCalls, 4);
    assert.equal(overviewObservations.length, 4);
    assert.equal(
      overviewObservations.every(
        (observation) =>
          observation.succeeded &&
          observation.durationMs >= 0 &&
          observation.projectId === "proj_test" &&
          observation.relativePath === ".",
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

    const result = await service.runGit(process.cwd(), ["--version"]);
    assert.match(result.stdout, /^git version /);
    assert.deepEqual(
      observations.map((observation) => Object.keys(observation as object)),
      [["bin", "command", "cwd", "durationMs", "succeeded"]],
    );
    assert.equal((observations[0] as { cwd: string }).cwd, process.cwd());
  });
});
