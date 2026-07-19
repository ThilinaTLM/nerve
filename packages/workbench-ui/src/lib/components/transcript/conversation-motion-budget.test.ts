import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CONVERSATION_MOTION_POLICY,
  ConversationMotionBudget,
} from "./conversation-motion-budget";

describe("ConversationMotionBudget", () => {
  it("uses exact standard, compact, and minimal batch boundaries", () => {
    const now = 0;
    const standard = new ConversationMotionBudget(() => now);
    assert.equal(standard.allocateBatch(3).profile, "standard");

    const compact = new ConversationMotionBudget(() => now);
    assert.equal(compact.allocateBatch(4).profile, "compact");
    assert.equal(compact.allocateBatch(4).profile, "compact");

    const minimal = new ConversationMotionBudget(() => now);
    assert.equal(minimal.allocateBatch(9).profile, "minimal");
  });

  it("accumulates separate claims inside the rolling window", () => {
    let now = 0;
    const budget = new ConversationMotionBudget(() => now);
    assert.equal(budget.allocateBatch(2).profile, "standard");
    now = 50;
    assert.equal(budget.allocateBatch(2).profile, "compact");
    now = 100;
    assert.equal(budget.allocateBatch(5).profile, "minimal");
  });

  it("holds a dense profile until the cooldown expires", () => {
    let now = 0;
    const budget = new ConversationMotionBudget(() => now);
    assert.equal(budget.allocateBatch(9).profile, "minimal");

    now = CONVERSATION_MOTION_POLICY.burstWindowMs + 1;
    assert.equal(budget.claim(), "minimal");

    now += CONVERSATION_MOTION_POLICY.cooldownMs;
    assert.equal(budget.claim(), "standard");
  });

  it("caps compact per-row delays", () => {
    const budget = new ConversationMotionBudget(() => 0);
    const allocation = budget.allocateBatch(8);
    assert.equal(allocation.profile, "compact");
    assert.deepEqual(allocation.delaysMs, [0, 12, 24, 36, 48, 60, 60, 60]);
  });

  it("resets between conversation scopes", () => {
    const budget = new ConversationMotionBudget(() => 0);
    assert.equal(budget.allocateBatch(9).profile, "minimal");
    budget.reset();
    assert.equal(budget.claim(), "standard");
  });
});
