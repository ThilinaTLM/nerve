import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CoreStorage } from "@nervekit/conversation-core";
import { createPermissionPort } from "./permission.adapter.js";

void test("supervision retains argument-sensitive effective risk and policy explanation", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-permission-risk-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const storage = {
    conversations: { get: () => ({ projectId: "project" }) },
    trustedResources: { find: () => undefined },
  } as unknown as CoreStorage;
  const port = createPermissionPort(home, storage);
  for (const [command, risk] of [
    ["pwd", "read"],
    ["rm -rf ./build", "destructive"],
  ] as const) {
    const result = await port.evaluate({
      conversationId: "conversation",
      projectDir: home,
      cwd: home,
      ruleSetId: "supervised",
      toolName: "bash",
      args: { command },
      origin: "user",
    });
    assert.equal(result.effectiveRisk, risk);
    assert.ok(result.reason);
    assert.ok(result.matchedRule);
  }
});
