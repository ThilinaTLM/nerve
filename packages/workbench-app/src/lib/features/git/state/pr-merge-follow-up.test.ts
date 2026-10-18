import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  GitOperationStartRequest,
  GitOperationStartResponse,
} from "@nervekit/contracts/git";
import type { ActivityStartedInput } from "$lib/application/activity/activity-state.svelte";
import { queueMergedPrFollowUp } from "./pr-merge-follow-up.js";

void test("post-merge update queues the explicit base branch and observes the returned ID before announcing queued, not completed", async () => {
  const starts: GitOperationStartRequest[] = [];
  const observed: ActivityStartedInput[] = [];
  const notifications: string[] = [];
  let acknowledge!: (response: GitOperationStartResponse) => void;
  const queued = queueMergedPrFollowUp(
    {
      projectId: "proj_one",
      repo: "nested/repo",
      number: 42,
      baseBranch: "release",
    },
    {
      start: (input) => {
        starts.push(input);
        return new Promise((resolve) => {
          acknowledge = resolve;
        });
      },
      activities: {
        observeStarted: (input) => {
          observed.push(input);
        },
      },
      notify: (message) => {
        assert.equal(observed[0]?.id, "returned-id");
        notifications.push(message);
      },
    },
  );
  assert.deepEqual(starts, [
    {
      projectId: "proj_one",
      repo: "nested/repo",
      kind: "switchBaseAndPull",
      baseBranch: "release",
    },
  ]);
  assert.deepEqual(observed, []);
  assert.deepEqual(notifications, []);
  acknowledge({ operationId: "returned-id" });
  await queued;
  assert.deepEqual(observed, [
    {
      id: "returned-id",
      kind: "git.switchBaseAndPull",
      title: "Switch to base and pull · nested/repo",
      scope: { projectId: "proj_one", repositoryPath: "nested/repo" },
    },
  ]);
  assert.deepEqual(notifications, [
    "Merged pull request #42; release update queued in Activity",
  ]);
  assert.doesNotMatch(notifications[0]!, /and updated|update completed/);
});

void test("failed post-merge start never invents an activity ID or claims an update was queued", async () => {
  const observed: ActivityStartedInput[] = [];
  const notifications: string[] = [];
  await assert.rejects(
    queueMergedPrFollowUp(
      { projectId: "proj_one", repo: ".", number: 42, baseBranch: "main" },
      {
        start: async () => {
          throw new Error("could not start");
        },
        activities: {
          observeStarted: (input) => {
            observed.push(input);
          },
        },
        notify: (message) => {
          notifications.push(message);
        },
      },
    ),
    /could not start/,
  );
  assert.deepEqual(observed, []);
  assert.deepEqual(notifications, []);
});
