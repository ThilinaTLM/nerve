import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ConversationRecord } from "@nervekit/contracts/conversations";
import {
  PROJECT_HOME_RECENT_LIMIT,
  buildMobileProjectHome,
} from "./mobile-project-home.js";

function conversation(
  id: string,
  lastUserMessageAt: string,
  overrides: Partial<ConversationRecord> = {},
): ConversationRecord {
  return {
    id,
    projectId: "proj_a",
    title: id,
    mode: "code",
    permissionLevel: "standard",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    lastUserMessageAt,
    ...overrides,
  } as ConversationRecord;
}

describe("buildMobileProjectHome", () => {
  it("puts busy conversations first, then the latest prompts", () => {
    const conversations = [
      conversation("conv_1", "2026-01-01T00:00:00.000Z"),
      conversation("conv_2", "2026-01-05T00:00:00.000Z"),
      conversation("conv_busy", "2026-01-02T00:00:00.000Z"),
      conversation("conv_done", "2026-01-09T00:00:00.000Z", {
        completedAt: "2026-01-09T00:00:00.000Z",
      }),
      ...Array.from({ length: 6 }, (_, index) =>
        conversation(`conv_old_${index}`, "2025-12-01T00:00:00.000Z"),
      ),
    ];
    const model = buildMobileProjectHome({
      conversations,
      activityById: { conv_busy: { tone: "info", busy: true } },
      liveTaskCount: 0,
      prCount: 0,
    });

    assert.equal(model.recent.length, PROJECT_HOME_RECENT_LIMIT);
    assert.deepEqual(
      model.recent.slice(0, 3).map((row) => row.id),
      ["conv_busy", "conv_2", "conv_1"],
    );
    assert.equal(model.conversationCount, conversations.length);
  });

  it("summarises tasks, git and pull requests", () => {
    const quiet = buildMobileProjectHome({
      conversations: [],
      activityById: {},
      liveTaskCount: 0,
      prCount: 0,
    });
    assert.equal(quiet.tasksDetail, "No running tasks");
    assert.equal(quiet.gitDetail, "No repository");
    assert.equal(quiet.pullRequestsDetail, "No open pull requests");

    const busy = buildMobileProjectHome({
      conversations: [],
      activityById: {},
      liveTaskCount: 1,
      git: { changeCount: 3, branch: "main" },
      prCount: 2,
    });
    assert.equal(busy.tasksDetail, "1 task running");
    assert.equal(busy.gitDetail, "3 uncommitted changes");
    assert.equal(busy.pullRequestsDetail, "2 open");

    const clean = buildMobileProjectHome({
      conversations: [],
      activityById: {},
      liveTaskCount: 0,
      git: { changeCount: 0 },
      prCount: 0,
    });
    assert.equal(clean.gitDetail, "Working tree clean");
  });
});
