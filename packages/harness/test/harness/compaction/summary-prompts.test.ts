import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PLAN_IMPLEMENTATION_SUMMARIZATION_SYSTEM_PROMPT,
  SUMMARIZATION_PROMPT,
  SUMMARIZATION_SYSTEM_PROMPT,
  summarizationPrompts,
} from "../../../src/harness/compaction/compaction.js";

const requiredHeadings = [
  "Goal",
  "Requirements and Constraints",
  "Work Completed",
  "Work Remaining",
  "Key Decisions",
  "Current Working State",
  "Continuation Plan",
  "Critical References",
];

describe("compaction summary prompts", () => {
  it("keeps the default summarization prompts unchanged", () => {
    assert.deepEqual(summarizationPrompts(undefined, false), {
      systemPrompt: SUMMARIZATION_SYSTEM_PROMPT,
      userPrompt: SUMMARIZATION_PROMPT,
    });
  });

  it("builds a plan-aware implementation handoff without duplicating the plan", () => {
    const planPath = "/home/test/.nerve/plans/feature.md";
    const prompts = summarizationPrompts(
      { kind: "plan-implementation", planPath },
      false,
    );

    assert.equal(
      prompts.systemPrompt,
      PLAN_IMPLEMENTATION_SUMMARIZATION_SYSTEM_PROMPT,
    );
    assert.match(
      prompts.userPrompt,
      new RegExp(planPath.replaceAll("/", "\\/")),
    );
    assert.match(prompts.userPrompt, /source of truth/i);
    assert.match(
      prompts.userPrompt,
      /do not restate, paraphrase, or duplicate/i,
    );
    for (const heading of requiredHeadings) {
      assert.match(prompts.userPrompt, new RegExp(`^## ${heading}$`, "m"));
    }
  });
});
