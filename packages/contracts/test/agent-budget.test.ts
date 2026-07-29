import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { agentBudgetSchema } from "../src/domains/agents/agent.schema.js";

describe("agent budget schema", () => {
  it("keeps depth policy while stripping legacy lifetime-run fields", () => {
    const budget = agentBudgetSchema.parse({
      depth: 1,
      maxDepth: 3,
      maxRuns: 8,
      usedRuns: 8,
    });

    assert.deepEqual(budget, { depth: 1, maxDepth: 3 });
  });
});
