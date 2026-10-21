import assert from "node:assert/strict";
import test from "node:test";
import {
  agentProfileModelSchema,
  agentProfileThinkingSchema,
  agentProfilePermissionSchema,
  agentProfileCompactionSchema,
  agentProfileScalarKind,
  lockedValue,
  type AgentProfileScalar,
} from "../../src/domains/agent-profiles/index.js";

test("every scalar supports Inherit, Set, default and Lock without accepting legacy lead", () => {
  for (const [schema, concrete] of [
    [agentProfileModelSchema, "provider/model"],
    [agentProfileThinkingSchema, "high"],
    [agentProfilePermissionSchema, "custom-rule-set"],
    [agentProfileCompactionSchema, { profile: "balanced" }],
  ] as const) {
    for (const value of [
      "inherit",
      "default",
      concrete,
      { lock: concrete },
      { lock: "default" },
    ])
      assert.deepEqual(schema.parse(value), value);
    for (const value of [
      { lock: "inherit" },
      { lock: "default", extra: true },
      { lock: { lock: "default" } },
    ])
      assert.equal(schema.safeParse(value).success, false);
  }
  assert.equal(agentProfileModelSchema.safeParse("lead").success, false);
  assert.equal(agentProfileThinkingSchema.safeParse("lead").success, false);
});

test("scalar helpers distinguish concrete object values from locks and leave default unresolved", () => {
  const concrete = { profile: "balanced" } as const;
  const cases: [AgentProfileScalar<typeof concrete>, string, unknown][] = [
    ["inherit", "inherit", undefined],
    ["default", "set", undefined],
    [concrete, "set", undefined],
    [{ lock: concrete }, "lock", concrete],
    [{ lock: "default" }, "lock", "default"],
  ];
  for (const [setting, kind, locked] of cases) {
    assert.equal(agentProfileScalarKind(setting), kind);
    assert.deepEqual(lockedValue(setting), locked);
  }
});
