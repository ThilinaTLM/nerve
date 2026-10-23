import assert from "node:assert/strict";
import { test } from "node:test";
import { productionAdmissionFixture } from "./execution-admission/production-admission-fixture.js";

void test(
  "production supervision retains argument-sensitive risk and policy explanation",
  { skip: process.platform === "win32" },
  async (t) => {
    const f = await productionAdmissionFixture(t);
    await f.save({ permissionRuleSetId: "supervised" });
    for (const [command, risk] of [
      ["pwd", "read"],
      ["rm -rf ./build", "destructive"],
    ] as const) {
      const call = await f.command(command);
      if (call === "delivered" || !("toolName" in call))
        assert.fail("Expected call");
      const result = f.runtime.storage.toolCalls.get(call.id)!.supervision!;
      assert.equal(result.effectiveRisk, risk);
      assert.ok(result.reason);
      assert.ok(result.matchedRule);
    }
    assert.equal(f.spawns.length, 0);
  },
);
