import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
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
