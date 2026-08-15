import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shouldRefreshWorkspace } from "./workspace-event-policy";

describe("workspace run lifecycle events", () => {
  it("does not schedule snapshot refreshes for locally-projected events", () => {
    // Run lifecycle events project agent status locally.
    for (const type of [
      "run.started",
      "run.waiting",
      "run.resumed",
      "run.retrying",
      "run.completed",
      "run.cancelled",
      "run.failed",
      "run.suspended",
    ]) {
      assert.equal(shouldRefreshWorkspace(type), false, type);
    }
    // Interaction and agent events carry complete records for the reducers.
    for (const type of [
      "toolCall.updated",
      "agent.configured",
      "agent.status_changed",
      "agent.mode_changed",
    ]) {
      assert.equal(shouldRefreshWorkspace(type), false, type);
    }
  });

  it("keeps snapshot refreshes for events reducers cannot fully project", () => {
    for (const type of [
      "conversation.created",
      "conversation.deleted",
      "conversation.compacted",
      "conversation.branch_summarized",
      "conversation.navigated",
      "agent.created",
      "agent.subagent_started",
      "task.updated",
      "plan.written",
      "settings.updated",
    ]) {
      assert.equal(shouldRefreshWorkspace(type), true, type);
    }
  });
});
