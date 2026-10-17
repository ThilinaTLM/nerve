import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { mock } from "node:test";
import {
  getModelRegistry,
  registerAgentScriptedProvider,
} from "@nervekit/harness/models";
import { ConversationCore } from "../core.js";
import { ConversationRunner } from "./conversation-runner.js";
import {
  createConversation,
  options,
  waitUntil,
} from "./lifecycle-test-helpers.js";

for (const boundary of ["retry", "overflow", "capacity"] as const) {
  void test(`${boundary}: refresh request config without replaying inputs or mutating an in-flight request`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "nerve-request-freshness-"));
    const oldProvider = registerAgentScriptedProvider({
      provider: `old-${randomUUID()}`,
      steps: [
        {
          type: "providerError",
          message:
            boundary === "overflow"
              ? "maximum context length exceeded"
              : "RETRYABLE: temporary failure",
        },
      ],
    });
    const newProvider = registerAgentScriptedProvider({
      provider: `new-${randomUUID()}`,
      steps: [
        { type: "assistantText", text: "Done" },
        { type: "assistantText", text: "Continued" },
      ],
    });
    const oldModel = oldProvider.getModel("scripted-fast")!;
    const newModel = newProvider.getModel("scripted-fast")!;
    const preparations: string[] = [];
    const resolutions: string[] = [];
    const opts = options(
      directory,
      join(directory, "core.sqlite"),
      {
        resolve: async (selection) => {
          resolutions.push(selection.provider);
          const model =
            selection.provider === oldModel.provider ? oldModel : newModel;
          return {
            model: {
              ...model,
              contextWindow:
                (boundary === "capacity" && model === newModel) ||
                selection.modelId === "smaller"
                  ? 100
                  : 1_000_000,
            },
          };
        },
      },
      {
        execute: async () => {
          throw new Error("No tools expected");
        },
        isReplaySafe: () => false,
      },
    );
    opts.turnResources.prepare = async ({ config }) => {
      const prompt = `${config.model.provider}:${config.reasoningLevel}:${config.mode}:${config.instructions}`;
      preparations.push(prompt);
      return { systemPrompt: prompt, tools: [] };
    };
    const core = new ConversationCore(opts);
    const registry = getModelRegistry();
    const original = registry.streamSimple;
    const requests: {
      provider: string;
      reasoning: unknown;
      prompt: string | undefined;
      messages: unknown;
    }[] = [];
    let compactions = 0;
    const configureNext = () =>
      core.configure("conv_fresh", {
        model: { provider: newModel.provider, modelId: newModel.id },
        reasoningLevel: "high",
        mode: "planning",
        instructions: "new",
      });
    // Compaction scheduling is the runner's responsibility; summary generation
    // is tested at its own layer. A save during compaction must win afterward.
    const compact = mock.method(
      ConversationRunner.prototype,
      "compact",
      async () => {
        compactions++;
        const compactedSelection =
          opts.storage.conversations.getConfig("conv_fresh")!.model;
        assert.equal(
          opts.storage.conversations.getConfig("conv_fresh")!.model.provider,
          newModel.provider,
        );
        if (compactions === 1)
          core.configure("conv_fresh", {
            reasoningLevel: "low",
            mode: "coding",
            instructions: "after compaction",
            ...(boundary === "overflow"
              ? { model: { provider: newModel.provider, modelId: "smaller" } }
              : {}),
          });
        return compactedSelection;
      },
    );
    const stream = mock.method(
      registry,
      "streamSimple",
      (...args: Parameters<typeof original>) => {
        requests.push({
          provider: args[0].provider,
          reasoning: args[2]?.reasoning,
          prompt: args[1].systemPrompt,
          messages: structuredClone(args[1].messages),
        });
        if (requests.length === 1) {
          // The request has been prepared, but has not returned from the provider.
          configureNext();
          if (boundary !== "overflow")
            core.configure("conv_fresh", {
              reasoningLevel: "low",
              mode: "coding",
              instructions: "in flight",
            });
          assert.equal(
            args[1].systemPrompt,
            `${oldModel.provider}:off:coding:old`,
          );
          assert.equal(args[2]?.reasoning, undefined);
        }
        if (requests.length === 2 && boundary === "retry") {
          // A queued input continues this execution after the in-flight reply.
          core.configure("conv_fresh", {
            reasoningLevel: "off",
            mode: "coding",
            instructions: "continuation",
          });
          core.submitInput({
            conversationId: "conv_fresh",
            inputId: "input_next",
            text: "Continue",
            source: "user",
          });
        }
        return original.apply(registry, args);
      },
    );
    let retryChanges = 0;
    core.subscribe((change) => {
      if (
        change.kind === "event_appended" &&
        change.event.type === "system_event" &&
        change.event.payload.subtype === "execution_state" &&
        change.event.payload.transition === "retrying"
      ) {
        // This notification occurs after the failed attempt, at the start of
        // the retry delay. No timing guesses or sleeps are needed for the save.
        retryChanges++;
        configureNext();
      }
    });
    try {
      await core.start();
      await createConversation(core, "conv_fresh");
      core.configure("conv_fresh", {
        model: { provider: oldModel.provider, modelId: oldModel.id },
        instructions: "old",
      });
      core.submitInput({
        conversationId: "conv_fresh",
        inputId: "input_once",
        text: "User input ".repeat(200),
        source: "user",
      });
      await waitUntil(() => requests.length >= (boundary === "retry" ? 3 : 2));
      await waitUntil(
        () => core.getSnapshot("conv_fresh").conversation.status === "idle",
      );
      assert.equal(requests.length, boundary === "retry" ? 3 : 2);
      assert.equal(retryChanges, boundary === "overflow" ? 0 : 1);
      assert.equal(requests[0]!.provider, oldModel.provider);
      assert.equal(requests[1]!.provider, newModel.provider);
      assert.equal(
        requests[1]!.reasoning,
        boundary === "retry" ? "high" : "low",
      );
      assert.equal(
        requests[1]!.prompt,
        boundary === "retry"
          ? `${newModel.provider}:high:planning:new`
          : `${newModel.provider}:low:coding:after compaction`,
      );
      assert.deepEqual(requests[1]!.messages, requests[0]!.messages);
      assert.equal(
        compactions,
        boundary === "retry" ? 0 : boundary === "overflow" ? 2 : 1,
      );
      assert.equal(resolutions.length, 3);
      assert.equal(preparations.length, resolutions.length);
      assert.equal(
        core
          .getEventsSince("conv_fresh", 0)
          .filter(
            (event) =>
              event.type === "user_message" && event.inputId === "input_once",
          ).length,
        1,
      );

      // Subsequent requests prepare anew; prior bundles stay intact.
      if (boundary !== "retry") {
        core.configure("conv_fresh", {
          reasoningLevel: "off",
          mode: "coding",
          instructions: "continuation",
        });
        core.submitInput({
          conversationId: "conv_fresh",
          inputId: "input_next",
          text: "Continue",
          source: "user",
        });
      } else {
        assert.equal(
          core
            .getEventsSince("conv_fresh", 0)
            .filter(
              (event) =>
                event.type === "system_event" &&
                event.payload.subtype === "execution_state" &&
                event.payload.transition === "started",
            ).length,
          1,
        );
      }
      await waitUntil(() => requests.length >= 3);
      await waitUntil(
        () => core.getSnapshot("conv_fresh").conversation.status === "idle",
      );
      assert.equal(requests[0]!.prompt, `${oldModel.provider}:off:coding:old`);
      assert.equal(requests[2]!.reasoning, undefined);
      assert.match(requests[2]!.prompt!, /:off:coding:continuation$/);
    } finally {
      stream.mock.restore();
      compact.mock.restore();
      await core.close();
      oldProvider.unregister();
      newProvider.unregister();
      await rm(directory, { recursive: true, force: true });
    }
  });
}

void test("compaction resolves current model, reasoning and settings without ordinary turn resources", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "nerve-compaction-freshness-"),
  );
  const provider = registerAgentScriptedProvider({
    provider: `compaction-${randomUUID()}`,
    steps: [
      {
        type: "assistantText",
        text: [
          "Goal",
          "Requirements and Constraints",
          "Work Completed",
          "Work Remaining",
          "Key Decisions",
          "Current Working State",
          "Continuation Plan",
          "Critical References",
        ]
          .map((heading) => `## ${heading}\nHistory checkpoint.`)
          .join("\n\n"),
      },
    ],
  });
  const model = provider.getModel("scripted-fast")!;
  let resolvedProvider: string | undefined;
  let settingsReads = 0;
  const opts = options(
    directory,
    join(directory, "core.sqlite"),
    {
      resolve: async (selection) => {
        resolvedProvider = selection.provider;
        // A save after compaction preparation begins belongs to the next request.
        core.configure("conv_compaction", {
          model: { provider: "saved-during-compaction", modelId: "next" },
          reasoningLevel: "off",
        });
        selection.modelId = "mutated-by-resolver";
        return { model: { ...model, reasoning: true, contextWindow: 100_000 } };
      },
    },
    {
      execute: async () => {
        throw new Error("No tools expected");
      },
      isReplaySafe: () => false,
    },
  );
  opts.turnResources.prepare = async () => {
    throw new Error("Compaction must not prepare ordinary resources");
  };
  opts.compactionSettings = () => {
    settingsReads++;
    return {
      auto: true,
      profile: "custom",
      customTriggerPercent: 80,
    };
  };
  const core = new ConversationCore(opts);
  const registry = getModelRegistry();
  const original = registry.streamSimple;
  let reasoning: unknown;
  const stream = mock.method(
    registry,
    "streamSimple",
    (...args: Parameters<typeof original>) => {
      reasoning = args[2]?.reasoning;
      assert.equal(args[0].provider, model.provider);
      return original.apply(registry, args);
    },
  );
  try {
    await createConversation(core, "conv_compaction");
    for (let index = 0; index < 10; index++) {
      opts.storage.events.append({
        id: `evt_history_${index}`,
        conversationId: "conv_compaction",
        type: "user_message",
        llmRepresentation: "user",
        turnId: null,
        inputId: null,
        payload: {
          text: `Message ${index}: ${"history ".repeat(1000)}`,
          originalText: "History",
          commandPreparation: null,
          source: "user",
          senderConversationId: null,
        },
        createdAt: new Date().toISOString(),
      });
    }
    core.configure("conv_compaction", {
      model: { provider: model.provider, modelId: model.id },
      reasoningLevel: "high",
    });
    await core.compact("conv_compaction");
    assert.equal(resolvedProvider, model.provider);
    assert.equal(reasoning, "high");
    assert.equal(settingsReads, 1);
    assert.equal(
      opts.storage.conversations.getConfig("conv_compaction")!.reasoningLevel,
      "off",
    );
    assert.equal(
      core
        .getEventsSince("conv_compaction", 0)
        .filter((event) => event.type === "compaction").length,
      1,
    );
  } finally {
    stream.mock.restore();
    await core.close();
    provider.unregister();
    await rm(directory, { recursive: true, force: true });
  }
});
