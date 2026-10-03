import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CONVERSATION_MOTION_POLICY,
  ConversationMotionBudget,
} from "./conversation-motion-budget.js";

function clockBudget() {
  let time = 1000;
  const budget = new ConversationMotionBudget(() => time);
  return {
    budget,
    advance(ms: number) {
      time += ms;
    },
  };
}

describe("ConversationMotionBudget.currentProfile", () => {
  it("reflects a burst of claims without registering events itself", () => {
    const { budget } = clockBudget();
    for (let index = 0; index < 20; index += 1) {
      assert.equal(budget.currentProfile(), "standard");
    }
    for (
      let index = 0;
      index < CONVERSATION_MOTION_POLICY.minimalThreshold;
      index += 1
    ) {
      budget.claim();
    }
    assert.equal(budget.currentProfile(), "minimal");
  });

  it("returns to standard after the cooldown", () => {
    const { budget, advance } = clockBudget();
    for (
      let index = 0;
      index < CONVERSATION_MOTION_POLICY.compactThreshold;
      index += 1
    ) {
      budget.claim();
    }
    assert.equal(budget.currentProfile(), "compact");
    advance(CONVERSATION_MOTION_POLICY.cooldownMs);
    assert.equal(budget.currentProfile(), "standard");
  });
});
