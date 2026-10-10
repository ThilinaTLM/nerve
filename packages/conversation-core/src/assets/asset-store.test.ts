import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { openCoreStorage } from "../storage/core-storage.js";
import { AssetStore } from "./asset-store.js";

void test("image reads require a known conversation, image category and safe image media type", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nerve-image-assets-"));
  const storage = openCoreStorage(":memory:");
  const assets = new AssetStore(directory, storage);
  const now = "2026-10-10T00:00:00.000Z";
  try {
    storage.projects.insert({
      id: "proj_1",
      name: "Test",
      directory,
      createdAt: now,
      updatedAt: now,
    });
    storage.conversations.insert(
      {
        id: "conv_1",
        projectId: "proj_1",
        parentConversationId: null,
        parentToolCallId: null,
        headEventId: null,
        title: "Test",
        status: "idle",
        statusEventSequence: 0,
        statusClearedAt: null,
        paused: false,
        nextInputSequence: 1,
        pinnedAt: null,
        completedAt: null,
        lastUserMessageAt: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        conversationId: "conv_1",
        model: { provider: "test", modelId: "test" },
        reasoningLevel: "off",
        systemPrompt: null,
        permissionRuleSetId: "baseline",
        mode: "coding",
        workingDirectory: directory,
      },
    );
    const image = await assets.write({
      conversationId: "conv_1",
      toolCallId: "tool_1",
      category: "image",
      logicalPath: "conversations/conv_1/tool-calls/tool_1/image",
      content: new Uint8Array([1, 2, 3]),
      mediaType: "image/png",
    });
    assert.deepEqual(await assets.readImage(image.id), {
      bytes: Buffer.from([1, 2, 3]),
      mediaType: "image/png",
    });
    assert.equal(await assets.readImage("missing"), null);
    storage.assets.update(image.id, { category: "payload" });
    assert.equal(await assets.readImage(image.id), null);
    storage.assets.update(image.id, {
      category: "image",
      mediaType: "text/html",
    });
    assert.equal(await assets.readImage(image.id), null);
    storage.assets.update(image.id, { mediaType: "image/svg+xml" });
    assert.equal(await assets.readImage(image.id), null);
    storage.assets.update(image.id, { mediaType: "image/png" });
    storage.conversations.delete("conv_1");
    assert.equal(await assets.readImage(image.id), null);
  } finally {
    storage.close();
    await rm(directory, { recursive: true, force: true });
  }
});
