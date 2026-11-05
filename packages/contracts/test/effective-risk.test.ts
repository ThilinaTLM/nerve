import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  effectiveRiskForCategory,
  staticToolRiskSchema,
  toolRiskSchema,
} from "../src/domains/permissions/index.js";

describe("effectiveRiskForCategory", () => {
  const expected = {
    read: "read",
    write: "workspace_write",
    network: "network",
    secret: "secret",
    destructive: "destructive",
    deployment: "deployment",
    agent_spawn: "agent_spawn",
    interaction: "interaction",
    unknown: "command",
  } as const;

  it("maps every static category to a valid effective risk", () => {
    for (const risk of staticToolRiskSchema.options) {
      assert.equal(effectiveRiskForCategory(risk), expected[risk]);
      assert.ok(toolRiskSchema.safeParse(expected[risk]).success);
    }
  });
});
