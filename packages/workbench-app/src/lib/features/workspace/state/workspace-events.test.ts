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
    assert.equal(runtimeAgentStatusFromEvent("run.retrying"), "running");
    assert.equal(runtimeAgentStatusFromEvent("run.completed"), "idle");
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

  it("refreshes workspace state across the answer continuation sequence", () => {
    for (const type of ["run.waiting", "run.retrying", "run.completed"]) {
      assert.equal(shouldRefreshWorkspace(type), true, type);
    }
  });
});
