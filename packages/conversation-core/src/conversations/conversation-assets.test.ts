import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ConversationCore } from "../core.js";
import { MissingAssetError } from "../assets/asset-store.js";
import {
  options,
  createConversation,
} from "../runtime/lifecycle-test-helpers.js";

void test("missing result/image assets remain distinct from another conversation's image", async () => {
  const directory = await mkdtemp(join(tmpdir(), "conv-resilience-assets-"));
  const unexpected = async (): Promise<never> => {
    throw new Error("No execution expected");
  };
  const opts = options(
    directory,
    join(directory, "core.sqlite"),
    { resolve: unexpected },
    { execute: unexpected, isReplaySafe: () => false },
  );
  const core = new ConversationCore(opts);
  try {
    await core.start();
    await createConversation(core, "one");
    await createConversation(core, "other");
    const image = await core.assets.write({
      conversationId: "other",
      toolCallId: "other_tool",
      category: "image",
      logicalPath: "conversations/other/tool-calls/other_tool/image.png",
      mediaType: "image/png",
      content: new Uint8Array([1]),
    });
    const result = await core.assets.write({
      conversationId: "one",
      toolCallId: "tool",
      category: "payload",
      logicalPath: "conversations/one/tool-calls/tool/result.json",
      content: JSON.stringify({
        contentBlocks: [
          { type: "image", assetId: image.id, mimeType: "image/png" },
        ],
      }),
    });
    opts.storage.events.append({
      id: "evt_tool",
      conversationId: "one",
      type: "tool_call_response",
      llmRepresentation: "user",
      turnId: null,
      inputId: null,
      createdAt: new Date().toISOString(),
      payload: {
        toolCallId: "tool",
        providerCallId: null,
        toolName: "read",
        arguments: {},
        origin: "user",
        assistantEventId: null,
        contentIndex: null,
        outcome: "completed",
        agentProjection: [],
        userProjection: { argsPreview: {}, resultPreview: {} },
        supervision: null,
        interactionResolution: null,
        resolutionRequestId: null,
        assetIds: [result.id],
      },
    });
    await assert.rejects(
      core.getToolCallDetails("one", "tool"),
      (error: unknown) =>
        error instanceof Error &&
        !(error instanceof MissingAssetError) &&
        error.message === "Image asset does not belong to tool call",
    );
    opts.storage.assets.delete(image.id);
    await assert.rejects(
      core.getToolCallDetails("one", "tool"),
      MissingAssetError,
    );
    await rm(core.assets.path(result.logicalPath));
    await assert.rejects(
      core.getToolCallDetails("one", "tool"),
      (error: unknown) =>
        error instanceof MissingAssetError &&
        !error.message.includes(directory),
    );
  } finally {
    await core.close();
    await rm(directory, { recursive: true, force: true });
  }
});
