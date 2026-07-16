import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  runtimeAgentStatusFromEvent,
  shouldRefreshWorkspace,
} from "./workspace-event-policy";

describe("workspace run lifecycle events", () => {
  it("maps canonical wait and resume events to agent status", () => {
    assert.equal(runtimeAgentStatusFromEvent("run.started"), "running");
    assert.equal(runtimeAgentStatusFromEvent("run.waiting"), "awaiting_user");
    assert.equal(runtimeAgentStatusFromEvent("run.resumed"), "running");
    assert.equal(runtimeAgentStatusFromEvent("run.retrying"), "running");
    assert.equal(runtimeAgentStatusFromEvent("run.completed"), "idle");
    assert.equal(runtimeAgentStatusFromEvent("run.cancelled"), "aborted");
  });

  it("retains suspended and failed status projections", () => {
    assert.equal(runtimeAgentStatusFromEvent("run.suspended"), "awaiting_user");
    assert.equal(runtimeAgentStatusFromEvent("run.failed"), "error");
    assert.equal(
      runtimeAgentStatusFromEvent("run.failed", { aborted: true }),
      "aborted",
    );
    assert.equal(runtimeAgentStatusFromEvent("unrelated.event"), undefined);
  });

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
      "approval.updated",
      "userQuestion.updated",
      "planReview.updated",
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
      "agent.created",
      "agent.subagent_started",
      "toolCall.updated",
      "task.updated",
      "plan.written",
      "settings.updated",
    ]) {
      assert.equal(shouldRefreshWorkspace(type), true, type);
    }
  });
});
