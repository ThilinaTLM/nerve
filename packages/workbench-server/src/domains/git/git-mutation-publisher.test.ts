import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GitService,
  GitCommandError,
  inGitLane,
  type GitActivityPort,
} from "@nervekit/tools/git";
import {
  gitMutationFailureActivityId,
  withGitMutationReporting,
} from "./git-mutation-publisher.js";

void test("quick failures produce bounded sanitized activity errors and never invalidate reads", async () => {
  const failures: string[] = [];
  let invalidated = 0;
  const activities: GitActivityPort = {
    start: () => ({
      id: "failed",
      progress() {},
      succeed() {},
      cancelled() {},
      interrupt() {},
      fail: (error) => {
        failures.push(error.message);
      },
    }),
  };
  const git = {
    stageFile: async () => {
      throw new Error("token=secret https://user:password@remote.invalid");
    },
    invalidateRepoReads: () => {
      invalidated++;
    },
  } as unknown as GitService;
  const decorated = withGitMutationReporting(git, activities);
  await assert.rejects(decorated.stageFile("proj_test", ".", "file"));
  assert.equal(invalidated, 0);
  assert.equal(failures.length, 1);
  assert.doesNotMatch(failures[0], /secret|password|remote.invalid/);
});
void test("actual success invalidates shared reads once and notifies the workspace store", async () => {
  let invalidated = 0;
  const mutations: string[] = [];
  const result = { repo: { relativePath: ".", currentBranch: "main" } };
  const git = {
    stageFile: async () => result,
    invalidateRepoReads: (id: string, repo: string) => {
      assert.equal(id, "proj_test");
      assert.equal(repo, ".");
      invalidated++;
    },
  } as unknown as GitService;
  const decorated = withGitMutationReporting(git, undefined, (method) => {
    mutations.push(method);
    throw new Error("signal failed");
  });
  assert.equal(await decorated.stageFile("proj_test", ".", "file"), result);
  assert.equal(invalidated, 1);
  assert.deepEqual(mutations, ["stageFile"]);
});

void test("switch failure reports a useful safe Activity in repository scope, preserving the original error", async () => {
  const service = new GitService(() => ({ dir: process.cwd(), name: "test" }));
  const commandError = new GitCommandError(
    "git switch secret-token",
    1,
    "error: Your local changes to the following files would be overwritten by checkout:\n\t/private/secret-path\nhttps://user:password@remote.invalid",
  );
  let original: unknown;
  try {
    await service.mapGit(async () => {
      throw commandError;
    });
  } catch (error) {
    original = error;
  }
  const starts: Parameters<GitActivityPort["start"]>[0][] = [];
  const failures: unknown[] = [];
  let invalidated = 0;
  const activities: GitActivityPort = {
    start: (input) => {
      starts.push(input);
      return {
        id: "failed",
        progress() {},
        succeed() {},
        cancelled() {},
        interrupt() {},
        fail: (error) => {
          failures.push(error);
        },
      };
    },
  };
  const git = {
    switchBranch: async () => {
      throw original;
    },
    invalidateProjectReads: () => {
      invalidated++;
    },
  } as unknown as GitService;
  const decorated = withGitMutationReporting(git, activities);
  await assert.rejects(
    decorated.switchBranch("proj_test", "repo", "target"),
    (error: unknown) => error === original,
  );
  assert.deepEqual(starts, [
    {
      kind: "git.switchBranch",
      title: "Switch branch failed",
      scope: { projectId: "proj_test", repositoryPath: "repo" },
    },
  ]);
  assert.deepEqual(failures, [
    {
      category: "local-changes",
      message:
        "Commit or stash your local changes before retrying; Git would overwrite them.",
    },
  ]);
  assert.doesNotMatch(
    JSON.stringify({ starts, failures }),
    /secret|private|password|remote.invalid/,
  );
  assert.equal(invalidated, 0);
  assert.equal(gitMutationFailureActivityId(original), "failed");

  // A tracked operation already owns terminal Activity reporting.
  await inGitLane(
    process.cwd(),
    false,
    async () => {
      await assert.rejects(
        decorated.switchBranch("proj_test", "repo", "target"),
        (error: unknown) => error === original,
      );
    },
    { activityId: "tracked-operation" },
  );
  assert.equal(gitMutationFailureActivityId(original), undefined);
  assert.equal(starts.length, 1);
  assert.equal(failures.length, 1);
});

void test("Activity reporting failures do not replace the mutation error", async () => {
  const original = new Error("private diagnostic");
  const git = {
    switchBranch: async () => {
      throw original;
    },
  } as unknown as GitService;
  const decorated = withGitMutationReporting(git, {
    start() {
      throw new Error("reporting unavailable");
    },
  });
  await assert.rejects(
    decorated.switchBranch("proj_test", ".", "main"),
    (error: unknown) => error === original,
  );
});

void test("reused errors lose prior metadata when reporting fails or is unavailable", async () => {
  const original = Object.freeze(new Error("mutation failed"));
  const git = {
    switchBranch: async () => {
      throw original;
    },
  } as unknown as GitService;
  let failure: "start" | "fail" | undefined;
  const activities: GitActivityPort = {
    start() {
      if (failure === "start") throw new Error("start failed");
      return {
        id: "reported",
        progress() {},
        succeed() {},
        cancelled() {},
        interrupt() {},
        fail() {
          if (failure === "fail") throw new Error("fail failed");
        },
      };
    },
  };
  const decorated = withGitMutationReporting(git, activities);
  const reject = (service: GitService) =>
    assert.rejects(
      service.switchBranch("proj_test", ".", "main"),
      (error: unknown) => error === original,
    );
  for (const next of ["start", "fail", "unavailable"] as const) {
    failure = undefined;
    await reject(decorated);
    assert.equal(gitMutationFailureActivityId(original), "reported");
    failure = next === "unavailable" ? undefined : next;
    await reject(
      next === "unavailable" ? withGitMutationReporting(git) : decorated,
    );
    assert.equal(gitMutationFailureActivityId(original), undefined);
  }
});

void test("primitive thrown values remain unchanged and have no metadata", async () => {
  for (const original of [null, undefined, "failure", 42]) {
    const git = {
      switchBranch: async () => {
        throw original;
      },
    } as unknown as GitService;
    await assert.rejects(
      withGitMutationReporting(git).switchBranch("proj_test", ".", "main"),
      (error: unknown) => error === original,
    );
    assert.equal(gitMutationFailureActivityId(original), undefined);
  }
});
