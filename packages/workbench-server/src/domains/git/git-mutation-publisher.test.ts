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
  withGitMutationEvents,
} from "./git-mutation-publisher.js";

void test("quick failures produce bounded sanitized activity errors and never repository success events", async () => {
  const failures: string[] = [];
  const events: unknown[] = [];
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
  } as unknown as GitService;
  const decorated = withGitMutationEvents(
    git,
    {
      publish: (_type, data) => {
        events.push(data);
      },
    },
    activities,
  );
  await assert.rejects(decorated.stageFile("proj_test", ".", "file"));
  assert.equal(events.length, 0);
  assert.equal(failures.length, 1);
  assert.doesNotMatch(failures[0], /secret|password|remote.invalid/);
});
void test("actual success invalidates shared reads once, and publication failure does not change outcome", async () => {
  let invalidated = 0;
  let published = 0;
  const result = { repo: { relativePath: ".", currentBranch: "main" } };
  const git = {
    stageFile: async () => result,
    invalidateProjectReads: (id: string) => {
      assert.equal(id, "proj_test");
      invalidated++;
    },
  } as unknown as GitService;
  const decorated = withGitMutationEvents(git, {
    publish: () => {
      published++;
      throw new Error("event failed");
    },
  });
  assert.equal(await decorated.stageFile("proj_test", ".", "file"), result);
  assert.equal(invalidated, 1);
  assert.equal(published, 1);
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
  let published = 0;
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
  const decorated = withGitMutationEvents(
    git,
    {
      publish: () => {
        published++;
      },
    },
    activities,
  );
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
  assert.equal(published, 0);
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
  assert.equal(published, 0);
});

void test("Activity reporting failures do not replace the mutation error", async () => {
  const original = new Error("private diagnostic");
  const git = {
    switchBranch: async () => {
      throw original;
    },
  } as unknown as GitService;
  const decorated = withGitMutationEvents(
    git,
    { publish() {} },
    {
      start() {
        throw new Error("reporting unavailable");
      },
    },
  );
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
  const decorated = withGitMutationEvents(git, { publish() {} }, activities);
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
      next === "unavailable"
        ? withGitMutationEvents(git, { publish() {} })
        : decorated,
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
      withGitMutationEvents(git, { publish() {} }).switchBranch(
        "proj_test",
        ".",
        "main",
      ),
      (error: unknown) => error === original,
    );
    assert.equal(gitMutationFailureActivityId(original), undefined);
  }
});
