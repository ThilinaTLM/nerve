import assert from "node:assert/strict";
import { test } from "node:test";
import type { GitService, GitActivityPort } from "@nervekit/tools/git";
import { withGitMutationEvents } from "./git-mutation-publisher.js";

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
