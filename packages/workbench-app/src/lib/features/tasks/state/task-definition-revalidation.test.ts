import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createTaskDefinitionRevalidationGate } from "./task-definition-revalidation";

describe("task definition revalidation gate", () => {
  it("schedules once for repeated observations of one project", () => {
    const gate = createTaskDefinitionRevalidationGate();
    const first = gate.enter("project-a");

    assert.ok(first);
    assert.equal(gate.enter("project-a"), undefined);
    assert.equal(gate.enter("project-a"), undefined);
    assert.equal(gate.isCurrent(first), true);
  });

  it("resets when no project is active", () => {
    const gate = createTaskDefinitionRevalidationGate();
    const first = gate.enter("project-a");

    assert.ok(first);
    assert.equal(gate.enter(undefined), undefined);
    assert.equal(gate.isCurrent(first), false);
    assert.ok(gate.enter("project-a"));
  });

  it("schedules every real project switch, including returning to a project", () => {
    const gate = createTaskDefinitionRevalidationGate();

    const firstA = gate.enter("project-a");
    const firstB = gate.enter("project-b");
    const secondA = gate.enter("project-a");

    assert.ok(firstA);
    assert.ok(firstB);
    assert.ok(secondA);
    assert.equal(gate.isCurrent(firstA), false);
    assert.equal(gate.isCurrent(firstB), false);
    assert.equal(gate.isCurrent(secondA), true);
  });
});
