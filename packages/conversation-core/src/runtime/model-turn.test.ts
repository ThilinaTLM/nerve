import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { crc32, deflateSync } from "node:zlib";
import { registerManagedFauxProvider } from "@nervekit/harness/models";
import type { ConversationEvent } from "@nervekit/contracts/core";
import type { AssetStore } from "../assets/asset-store.js";
import { ConversationCore } from "../core.js";
import type { PiModel } from "../ports.js";
import { createConversation, options } from "./lifecycle-test-helpers.js";
import { ModelTurn } from "./model-turn.js";

for (const override of [null, "", " \tOverride 雪\r\n\n"])
  void test(`preview and request preserve exact context override ${JSON.stringify(override)}`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "nerve-prompt-preview-"));
    let resolutions = 0;
    const opts = options(
      directory,
      join(directory, "core.sqlite"),
      {
        resolve: async () => {
          resolutions++;
          return { model: { id: "test" } as PiModel };
        },
      },
      {
        execute: async () => {
          throw new Error("No tools expected");
        },
        isReplaySafe: () => false,
      },
    );
    const resourcePrompt = "\ufeff Resource café 雪\r\n\t";
    opts.turnResources.prepare = async () => ({
      systemPrompt: resourcePrompt,
      tools: [],
    });
    const core = new ConversationCore(opts);
    try {
      await createConversation(core, "c");
      await core.configure("c", {
        systemPrompt: override,
        instructions: "Context instructions",
      });
      const before = core.getSnapshot("c");
      const preview = await core.previewSystemPrompt({ conversationId: "c" });
      assert.equal(preview.status, "available");
      if (preview.status !== "available") return;
      assert.equal(preview.systemPrompt, override ?? resourcePrompt);
      assert.equal(resolutions, 0);
      assert.deepEqual(core.getSnapshot("c"), before);
      const turn = new ModelTurn(
        opts.models,
        opts.configuration,
        () => [],
        () => {},
      );
      const prepared = await turn.prepareRequest({
        conversation: before.conversation,
        config: await opts.configuration.resolveConfig!("c", before.config),
        projectDir: opts.storage.projects.get("proj_test")!.directory,
        path: [],
        turnId: "turn",
        signal: new AbortController().signal,
      });
      assert.deepEqual(
        Buffer.from(prepared.systemPrompt),
        Buffer.from(preview.systemPrompt),
      );
      assert.equal(resolutions, 1);
    } finally {
      await core.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

function grayscalePng(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth; color type 0 (grayscale)
  const rows = Buffer.alloc((width + 1) * height);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

void test("model requests fit projected images to provider dimension limits", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nerve-image-limit-"));
  const faux = registerManagedFauxProvider({
    api: "anthropic-messages",
    provider: `image-limit-${Date.now()}`,
    models: [{ id: "vision" }],
  });
  const sent: string[] = [];
  faux.setResponses([
    (context) => {
      for (const message of context.messages)
        if (message.role === "user" && typeof message.content !== "string")
          for (const block of message.content)
            if (block.type === "image") sent.push(block.data);
      throw new Error("Captured request");
    },
  ]);
  const model = faux.getModel("vision")!;
  const opts = options(
    directory,
    join(directory, "core.sqlite"),
    { resolve: async () => ({ model }) },
    {
      execute: async () => {
        throw new Error("No tools expected");
      },
      isReplaySafe: () => false,
    },
  );
  const core = new ConversationCore(opts);
  const original = grayscalePng(8100, 2);
  const assets = {
    read: async () => original,
  } as unknown as AssetStore;
  try {
    await createConversation(core, "c");
    const snapshot = core.getSnapshot("c");
    const event = {
      id: "evt_image",
      conversationId: "c",
      sequence: 1,
      previousEventId: null,
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
        agentProjection: [
          { type: "image", assetId: "asset_image", mimeType: "image/png" },
        ],
        userProjection: { argsPreview: {}, resultPreview: {} },
        supervision: null,
        interactionResolution: null,
        resolutionRequestId: null,
        assetIds: ["asset_image"],
      },
    } as unknown as ConversationEvent;
    const turn = new ModelTurn(
      opts.models,
      opts.configuration,
      () => [],
      () => {},
      assets,
    );
    await turn.run({
      conversation: snapshot.conversation,
      config: await opts.configuration.resolveConfig!("c", snapshot.config),
      projectDir: directory,
      path: [event],
      turnId: "turn",
      signal: new AbortController().signal,
    });
    assert.equal(sent.length, 1);
    const width = Buffer.from(sent[0]!, "base64").readUInt32BE(16);
    assert.equal(width, 8000);
  } finally {
    faux.unregister();
    await core.close();
    await rm(directory, { recursive: true, force: true });
  }
});

void test("prospective scoped preview uses overrides and context without creating a conversation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nerve-draft-preview-"));
  const opts = options(
    directory,
    join(directory, "core.sqlite"),
    {
      resolve: async () => {
        throw new Error("Preview never resolves credentials");
      },
    },
    {
      execute: async () => {
        throw new Error("No execution");
      },
      isReplaySafe: () => false,
    },
  );
  opts.turnResources.prepare = async ({ config, projectDir }) => {
    assert.equal(projectDir, directory);
    return { systemPrompt: config.instructions ?? "", tools: [] };
  };
  const core = new ConversationCore(opts);
  try {
    core.projects.create({ id: "p", name: "Project", directory });
    const preview = await core.previewSystemPrompt({
      projectId: "p",
      overrides: {
        model: { provider: "chosen", modelId: "chosen" },
        reasoningLevel: "high",
      },
      config: { instructions: "Draft instructions" },
    });
    assert.equal(preview.status, "available");
    if (preview.status === "available") {
      assert.equal(preview.systemPrompt, "Draft instructions");
      assert.equal(preview.resolution.settings.model?.modelId, "chosen");
    }
    assert.equal(core.listConversations({ projectId: "p" }).length, 0);
  } finally {
    await core.close();
    await rm(directory, { recursive: true, force: true });
  }
});
