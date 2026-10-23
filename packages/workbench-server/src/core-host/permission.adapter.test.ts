import assert from "node:assert/strict";
import test from "node:test";
import { readFile, writeFile } from "node:fs/promises";
import { productionAdmissionFixture } from "./execution-admission/production-admission-fixture.js";
import { createPermissionPort } from "./permission.adapter.js";
import { readHomeConfiguration } from "../infrastructure/configuration/home-configuration.js";

void test(
  "remembered permission rules fence cached production policy before acknowledgement",
  { skip: process.platform === "win32" },
  async (t) => {
    const f = await productionAdmissionFixture(t);
    await f.command();
    assert.equal(f.spawns.length, 1);
    const permissions = createPermissionPort(
      f.home,
      f.runtime.storage,
      f.runtime.admissionPolicy,
    );
    await permissions.addRule({
      scope: "conversation",
      conversationId: "c",
      projectDir: f.project,
      ruleSetId: "autonomous",
      rule: {
        id: "deny-bash",
        description: "Deny bash",
        enabled: true,
        priority: 100,
        enforcement: "overridable",
        when: { toolNames: ["bash"] },
        decision: "deny",
      },
    });
    const call = await f.command();
    if (call === "delivered" || !("toolName" in call))
      assert.fail("Expected call");
    const result = f.runtime.storage.events
      .since("c", 0)
      .find(
        (event) =>
          event.type === "tool_call_response" &&
          event.payload.toolCallId === call.id,
      );
    if (result?.type !== "tool_call_response") assert.fail("Expected result");
    assert.equal(result.payload.outcome, "denied");
    assert.equal(f.spawns.length, 1);
  },
);

void test(
  "harness validity is never permission authority in production admission",
  { skip: process.platform === "win32" },
  async (t) => {
    const f = await productionAdmissionFixture(t);
    const original = await readFile(f.paths.harnessConfigPath, "utf8");
    await writeFile(f.paths.harnessConfigPath, "broken obsolete harness");
    await readHomeConfiguration(f.paths);
    f.runtime.admissionPolicy.invalidate();
    await f.command();
    assert.equal(
      f.spawns.length,
      1,
      "invalid harness cannot change scoped autonomous authorization",
    );
    await f.save({ permissionRuleSetId: "read_only" });
    await f.command();
    assert.equal(
      f.spawns.length,
      1,
      "invalid harness cannot weaken a scoped denial either",
    );
    await writeFile(f.paths.harnessConfigPath, original);
  },
);
