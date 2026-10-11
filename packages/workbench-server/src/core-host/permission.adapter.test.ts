import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CoreStorage } from "@nervekit/conversation-core";
import { createPermissionPort } from "./permission.adapter.js";

void test("user-origin bash permission validation omits timeout while model calls require it", async () => {
  const home = await mkdtemp(join(tmpdir(), "nerve-bash-permission-"));
  try {
    const storage = {
      conversations: { get: () => ({ projectId: "project" }) },
      trustedResources: { find: () => undefined },
    } as unknown as CoreStorage;
    const port = createPermissionPort(home, storage, async () => ({
      autoPromotion: { enabled: false, afterMs: 120000 },
      maxTimeoutMs: 2001,
    }));
    const input = {
      conversationId: "conversation",
      projectDir: home,
      cwd: home,
      ruleSetId: "supervised",
      toolName: "bash",
      args: { command: "pwd" },
    };
    const result = await port.evaluate({ ...input, origin: "user" });
    assert.equal(result.decision, "approval");
    await assert.rejects(
      port.evaluate({ ...input, origin: "model" }),
      /Invalid validated arguments/,
    );
    assert.equal(
      (
        await port.evaluate({
          ...input,
          origin: "model",
          args: { command: "pwd", timeout: 2 },
        })
      ).decision,
      "approval",
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
