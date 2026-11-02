import assert from "node:assert/strict";
import { test } from "node:test";
import type { ConversationSummary } from "@nervekit/contracts/core";
import {
  buildMobileProjectHome,
  repoSyncLabel,
} from "./mobile-project-home.js";

function conversation(
  id: string,
  patch: Partial<ConversationSummary> = {},
): ConversationSummary {
  return {
    id,
    createdAt: "2026-10-01T00:00:00Z",
    lastUserMessageAt: null,
    completedAt: null,
    ...patch,
  } as ConversationSummary;
}

test("recent puts busy conversations first and hides completed ones", () => {
  const model = buildMobileProjectHome({
    conversations: [
      conversation("old", { lastUserMessageAt: "2026-10-02T00:00:00Z" }),
      conversation("busy", { lastUserMessageAt: "2026-10-01T00:00:00Z" }),
      conversation("done", { completedAt: "2026-10-03T00:00:00Z" }),
    ],
    activityById: { busy: { tone: "info", busy: true } },
    liveLaunchCount: 1,
    prCount: 2,
  });
  assert.deepEqual(
    model.recent.map((item) => item.id),
    ["busy", "old"],
  );
  assert.equal(model.conversationCount, 3);
  assert.equal(model.prCount, 2);
  assert.equal(model.liveLaunchCount, 1);
  assert.equal(model.repo, undefined);
});

test("repository status carries branch, sync and changed count", () => {
  const model = buildMobileProjectHome({
    conversations: [],
    activityById: {},
    liveLaunchCount: 0,
    prCount: 0,
    git: {
      branch: "fix/touch",
      changeCount: 3,
      ahead: 2,
      behind: 0,
      hasUpstream: true,
    },
  });
  assert.deepEqual(model.repo, { branch: "fix/touch", sync: "↑2 ↓0" });
  assert.equal(model.changedCount, 3);
});

test("sync label needs an upstream", () => {
  assert.equal(repoSyncLabel({ hasUpstream: false, ahead: 1 }), undefined);
  assert.equal(repoSyncLabel({ hasUpstream: true }), "↑0 ↓0");
});
