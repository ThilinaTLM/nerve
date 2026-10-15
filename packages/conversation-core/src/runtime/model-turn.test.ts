import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { mock } from "node:test";
import {
  getModelRegistry,
  registerManagedFauxProvider,
} from "@nervekit/harness/models";
import { toolDefinitionByName } from "@nervekit/tools/catalog";
import { ConversationCore } from "../core.js";
import type { TurnResourcesPort } from "../ports.js";
import { createConversation, options } from "./lifecycle-test-helpers.js";
import { ModelTurn } from "./model-turn.js";

for (const override of [null, "", " \tOverride 雪\r\n\n"]) {
  void test(`preview and request share preparation with override ${JSON.stringify(override)}`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "nerve-prompt-preview-"));
    const provider = registerManagedFauxProvider({
      provider: `prompt-preview-${randomUUID()}`,
      models: [{ id: "test", name: "Test" }],
    });
    const resourcePrompt = "\ufeff  Resource café 雪\r\n\n\t";
    const expected = override ?? resourcePrompt;
    const preparations: Parameters<TurnResourcesPort["prepare"]>[0][] = [];
    let resolutions = 0;
    let streams = 0;
    let requestPrompt: string | undefined;
    provider.setResponses([
      async () => {
        streams++;
        throw new Error("Captured stream boundary");
      },
    ]);
    const opts = options(
      directory,
      join(directory, "core.sqlite"),
      {
        resolve: async () => {
          resolutions++;
          const model = provider.getModel("test");
          assert.ok(model);
          return { model };
        },
      },
      {
        execute: async () => {
          throw new Error("No tool execution expected");
        },
        isReplaySafe: () => false,
      },
    );
    opts.turnResources = {
      prepare: async (input) => {
        preparations.push(input);
        return { systemPrompt: resourcePrompt, tools: [] };
      },
    };
    const core = new ConversationCore(opts);
    const registry = getModelRegistry();
    const originalStream = registry.streamSimple;
    const streamMock = mock.method(
      registry,
      "streamSimple",
      (...args: Parameters<typeof originalStream>) => {
        requestPrompt = args[1].systemPrompt;
        return originalStream.apply(registry, args);
      },
    );
    try {
      await createConversation(core, "conv_preview");
      core.configure("conv_preview", {
        systemPrompt: override,
        instructions: "Current conversation instructions",
        workingDirectory: join(directory, "working"),
        mode: "planning",
      });
      const definition = toolDefinitionByName("bash");
      assert.ok(definition);
      core.registerCoreTool({
        definition,
        execute: async () => {
          throw new Error("No core tool execution expected");
        },
      });
      const before = core.getSnapshot("conv_preview");
      assert.equal(
        await core.previewSystemPrompt({ conversationId: "conv_preview" }),
        expected,
      );
      assert.equal(resolutions, 0);
      assert.equal(streams, 0);
      assert.deepEqual(core.getSnapshot("conv_preview"), before);
      const previewInput = preparations[0]!;
      assert.deepEqual(
        previewInput.conversation,
        opts.storage.conversations.get("conv_preview"),
      );
      assert.deepEqual(
        previewInput.config,
        opts.storage.conversations.getConfig("conv_preview"),
      );
      assert.equal(
        previewInput.projectDir,
        opts.storage.projects.get("proj_test")!.directory,
      );
      assert.notEqual(
        previewInput.projectDir,
        previewInput.config.workingDirectory,
      );
      assert.ok(
        previewInput.coreTools!.some((tool) => tool.name === "ask_user"),
      );
      assert.ok(previewInput.coreTools!.includes(definition));

      // Run the real model-turn boundary with the identical stored preparation inputs.
      const turn = new ModelTurn(
        opts.models,
        opts.turnResources,
        () => previewInput.coreTools!,
        () => {},
      );
      const result = await turn.run({
        ...previewInput,
        conversation: opts.storage.conversations.get("conv_preview")!,
        config: opts.storage.conversations.getConfig("conv_preview")!,
        path: [],
        turnId: "turn_preview",
        signal: new AbortController().signal,
      });
      assert.match(result.errorMessage ?? "", /Captured stream boundary/);
      assert.equal(requestPrompt, expected);
      assert.deepEqual(Buffer.from(requestPrompt!), Buffer.from(expected));
      assert.equal(resolutions, 1);
      assert.equal(streams, 1);
      assert.deepEqual(preparations[1], previewInput);

      // Each preview is freshly prepared, including when an explicit override wins.
      core.configure("conv_preview", {
        systemPrompt: null,
        instructions: "Changed",
      });
      opts.turnResources.prepare = async (input) => {
        assert.equal(input.config.instructions, "Changed");
        return { systemPrompt: "Fresh\n", tools: [] };
      };
      assert.equal(
        await core.previewSystemPrompt({ conversationId: "conv_preview" }),
        "Fresh\n",
      );
      assert.equal(resolutions, 1);
      assert.equal(streams, 1);

      await assert.rejects(
        core.previewSystemPrompt({ conversationId: "missing" }),
        /Conversation not found/,
      );
      const getProject = opts.storage.projects.get;
      opts.storage.projects.get = () => null;
      try {
        await assert.rejects(
          core.previewSystemPrompt({ conversationId: "conv_preview" }),
          /Project not found/,
        );
      } finally {
        opts.storage.projects.get = getProject;
      }
    } finally {
      streamMock.mock.restore();
      await core.close();
      provider.unregister();
      await rm(directory, { recursive: true, force: true });
    }
  });
}

void test("unsent preview uses draft values without creating a conversation and matches saved preparation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nerve-pending-preview-"));
  const opts = options(
    directory,
    join(directory, "core.sqlite"),
    {
      resolve: async () => {
        throw new Error("Preview must not resolve a model");
      },
    },
    {
      execute: async () => {
        throw new Error("Preview must not execute tools");
      },
      isReplaySafe: () => false,
    },
  );
  let savedCapabilities: unknown;
  let savedProfiles: unknown;
  opts.turnResources = {
    prepare: async (input) => ({
      systemPrompt: JSON.stringify({
        config: Object.fromEntries(
          Object.entries(input.config)
            .filter(([key]) => key !== "conversationId")
            .sort(([a], [b]) => a.localeCompare(b)),
        ),
        capabilities: input.capabilityOverrides ?? savedCapabilities,
        profiles: input.subagentProfileOverrides ?? savedProfiles,
      }),
      tools: [],
    }),
  };
  const core = new ConversationCore(opts);
  try {
    core.projects.create({ id: "proj_test", directory, name: "Test" });
    const config = {
      model: { provider: "draft", modelId: "selected" },
      reasoningLevel: "high" as const,
      mode: "planning" as const,
      systemPrompt: null,
      instructions: "Unsent instructions",
      permissionRuleSetId: "baseline",
      workingDirectory: join(directory, "draft-cwd"),
    };
    const capabilityOverrides = {
      schemaVersion: 2 as const,
      tools: {},
      toolSettings: {},
      skills: { nerve: {}, agentBrowser: {}, file: {} },
    };
    const subagentProfileOverrides = {
      schemaVersion: 1 as const,
      profiles: {},
    };
    const draft = {
      projectId: "proj_test",
      config,
      capabilityOverrides,
      subagentProfileOverrides,
    };
    const preview = await core.previewSystemPrompt(draft);
    assert.equal(opts.storage.conversations.get("conv_pending"), null);
    await core.createConversation({
      id: "conv_pending",
      projectId: "proj_test",
      title: "Pending",
    });
    core.configure("conv_pending", config);
    savedCapabilities = capabilityOverrides;
    savedProfiles = subagentProfileOverrides;
    assert.equal(
      await core.previewSystemPrompt({ conversationId: "conv_pending" }),
      preview,
    );
    core.configure("conv_pending", { instructions: "Old saved instructions" });
    assert.equal(await core.previewSystemPrompt(draft), preview);
  } finally {
    await core.close();
    await rm(directory, { recursive: true, force: true });
  }
});
