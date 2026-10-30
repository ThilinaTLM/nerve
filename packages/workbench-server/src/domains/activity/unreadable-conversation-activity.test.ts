import assert from "node:assert/strict";
import test from "node:test";
import { ActivityService } from "./activity.service.js";
import { UnreadableConversationActivity } from "./unreadable-conversation-activity.js";

void test("failures aggregate, preserve raw metadata, survive clear, and disappear only after successful deletion", async () => {
  const activities = new ActivityService(() => {}, 0);
  const rows = new Map(
    ["bad", "child"].map((id) => [
      id,
      {
        id,
        title: id === "bad" ? "Raw title" : "",
        projectId: "p",
        projectName: "Project",
        parentConversationId: null,
      },
    ]),
  );
  let deny = true;
  const notice = new UnreadableConversationActivity({
    activities,
    lookup: (id) => rows.get(id) ?? null,
    delete: async () => {
      if (deny) throw new Error("Could not remove files");
      rows.clear();
      notice.forget("child");
    },
  });
  notice.report("bad", new Error("malformed JSON"));
  notice.report("bad", new Error("malformed JSON"));
  notice.report("child", new Error("invalid status"));
  await Promise.resolve();
  const [first] = activities.list();
  assert.equal(activities.list().length, 1);
  assert.equal(first.title, "2 conversations couldn't be loaded");
  assert.deepEqual(
    first.unreadableConversations?.map((entry) => [
      entry.title,
      entry.projectName,
      entry.error,
    ]),
    [
      ["Raw title", "Project", "malformed JSON"],
      ["child", "Project", "invalid status"],
    ],
  );
  assert.equal(activities.clear(), 0);
  activities.start({ kind: "other", title: "Other" }).succeed();
  assert.equal(
    activities.list().length,
    1,
    "retention does not evict attention",
  );
  await assert.rejects(notice.delete("bad"), /Could not remove files/);
  assert.equal(activities.list().length, 1);
  notice.report("child", new Error("later read failed"));
  await Promise.resolve();
  assert.equal(activities.list()[0].id, first.id);
  assert.ok(activities.list()[0].revision > first.revision);
  deny = false;
  assert.deepEqual(await notice.delete("bad"), { removed: 1 });
  await Promise.resolve();
  assert.deepEqual(activities.list(), []);
  assert.deepEqual(await notice.delete("missing"), { removed: 0 });
  notice.report("already-deleted", new Error("stale reader"));
  await Promise.resolve();
  assert.deepEqual(activities.list(), []);
});
