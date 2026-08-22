import assert from "node:assert/strict";
import test from "node:test";
import {
  shouldRevealWorkbench,
  WorkbenchStartupMachine,
} from "./workbench-startup-machine";

test("startup phases are monotonic and cannot skip or regress", () => {
  const state = new WorkbenchStartupMachine();
  const generation = state.begin();
  assert.equal(state.transition(generation, "core-ready"), false);
  assert.equal(state.transition(generation, "critical"), true);
  assert.equal(state.transition(generation, "idle"), false);
  assert.equal(state.transition(generation, "core-ready"), true);
  assert.equal(state.transition(generation, "progressive"), true);
  assert.equal(state.transition(generation, "failed"), false);
  assert.equal(state.phase, "progressive");
});

test("reveals the workbench only after critical readiness or failure", () => {
  assert.equal(shouldRevealWorkbench("idle"), false);
  assert.equal(shouldRevealWorkbench("critical"), false);
  assert.equal(shouldRevealWorkbench("core-ready"), true);
  assert.equal(shouldRevealWorkbench("progressive"), true);
  assert.equal(shouldRevealWorkbench("failed"), true);
  assert.equal(shouldRevealWorkbench("stopped"), false);
});

test("stop invalidates the active generation", () => {
  const state = new WorkbenchStartupMachine();
  const generation = state.begin();
  assert.equal(state.stop(generation), true);
  assert.equal(state.isCurrent(generation), false);
  assert.equal(state.transition(generation, "critical"), false);
  assert.equal(state.phase, "stopped");
});
