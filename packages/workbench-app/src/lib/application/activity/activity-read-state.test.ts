import assert from "node:assert/strict";
import { test } from "node:test";
import type { Activity } from "@nervekit/contracts/activity";
import { ActivityController } from "./activity-controller.js";
import { updateActivityReadIds } from "./activity-read-state.js";

test("client replacements and clear prune read ids without pruning conversation or daemon ids", () => {
  let activities: Activity[] = [];
  let readIds = new Set(["conversation-read", "daemon-read"]);
  const controller = new ActivityController({
    list: async () => [],
    subscribe: () => () => undefined,
    changed: (next) => {
      activities = next;
      readIds = updateActivityReadIds(readIds, activities);
    },
    error: () => undefined,
  });
  for (let index = 0; index < 250; index++) {
    controller.notify({ key: "pr:refresh", title: "Failed", status: "failed" });
    assert.equal(readIds.has(activities[0].id), false);
    readIds = updateActivityReadIds(readIds, activities, [activities[0].id]);
    assert.equal(readIds.size, 3);
  }
  const retiredId = activities[0].id;
  controller.clearClientNotices();
  assert.deepEqual([...readIds], ["conversation-read", "daemon-read"]);
  const unchanged = updateActivityReadIds(readIds, activities, [retiredId]);
  assert.equal(unchanged, readIds);
  assert.equal(unchanged.has(retiredId), false);
});

test("retention and dismissal release read ids for retired client notices only", () => {
  let readIds = new Set(["conversation-read"]);
  const controller = new ActivityController({
    list: async () => [],
    subscribe: () => () => undefined,
    changed: (activities) => {
      readIds = updateActivityReadIds(
        readIds,
        activities,
        activities.map((entry) => entry.id),
      );
    },
    error: () => undefined,
  });
  for (let index = 0; index < 250; index++)
    controller.notify({
      key: `notice-${index}`,
      title: "Done",
      status: "succeeded",
    });
  assert.equal(readIds.size, 201);
  const id = [...readIds].find((id) => id.startsWith("client-notice:"))!;
  controller.dismissLocal(id);
  assert.equal(readIds.size, 200);
  assert.equal(readIds.has(id), false);
  assert.equal(readIds.has("conversation-read"), true);
});
