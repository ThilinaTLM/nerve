import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  effectiveRiskForCategory,
  staticToolRiskSchema,
  toolRiskSchema,
  type StaticToolRisk,
  type ToolRisk,
} from "../src/domains/permissions/index.js";

describe("effectiveRiskForCategory", () => {
  const expected = {
    read: "read",
    write: "workspace_write",
    external_read: "external_read",
    external_write: "external_write",
    secret: "secret",
    destructive: "destructive",
    deployment: "deployment",
    agent_spawn: "agent_spawn",
    interaction: "interaction",
    unknown: "command",
  } satisfies Record<StaticToolRisk, ToolRisk>;

  it("maps every static category to a valid effective risk", () => {
    for (const risk of staticToolRiskSchema.options) {
      assert.equal(effectiveRiskForCategory(risk), expected[risk]);
      assert.ok(toolRiskSchema.safeParse(expected[risk]).success);
    }
  });
});

describe("supervision.effectiveRisk", () => {
  it("reads a recorded legacy `network` as external_read", async () => {
    const { supervisionSchema } = await import("../src/domains/core/index.js");
    const parsed = supervisionSchema.parse({
      decision: "allow",
      effectiveRisk: "network",
      suggestedRules: [],
      authority: null,
    });
    assert.equal(parsed.effectiveRisk, "external_read");
  });
});
