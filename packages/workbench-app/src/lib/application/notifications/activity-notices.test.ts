import assert from "node:assert/strict";
import { test } from "node:test";
import type { ActivityNoticeInput } from "$lib/application/activity/activity-controller";
import {
  activityNoticeFor,
  recordActivityNotice,
  setActivityNoticeSink,
} from "./activity-notices.js";

test("failures and refusals record by default; successes only on request", () => {
  assert.equal(activityNoticeFor("error", "Boom")?.status, "failed");
  assert.equal(activityNoticeFor("warning", "Blocked")?.status, "failed");
  assert.equal(activityNoticeFor("success", "Copied"), undefined);
  assert.equal(activityNoticeFor("message", "Hi"), undefined);
  assert.equal(
    activityNoticeFor("success", "Deleted", { activity: true })?.status,
    "succeeded",
  );
  assert.equal(
    activityNoticeFor("error", "Tracked", { activity: false }),
    undefined,
  );
});

test("notices carry the description and dedupe by tag or title", () => {
  assert.deepEqual(activityNoticeFor("error", "Boom", { description: "why" }), {
    key: "notify:Boom",
    title: "Boom",
    status: "failed",
    message: "why",
  });
  assert.equal(activityNoticeFor("error", "Boom", { tag: "t" })?.key, "t");
});

test("recording is a no-op without a registered sink", () => {
  const seen: ActivityNoticeInput[] = [];
  setActivityNoticeSink(undefined);
  recordActivityNotice("error", "Lost");
  setActivityNoticeSink((notice) => seen.push(notice));
  recordActivityNotice("error", "Kept");
  recordActivityNotice("success", "Quiet");
  setActivityNoticeSink(undefined);
  assert.deepEqual(
    seen.map((notice) => notice.title),
    ["Kept"],
  );
});
