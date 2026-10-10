import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { registerAgentScriptedProvider } from "@nervekit/harness/models";
import type { ConversationEvent } from "@nervekit/contracts/core";
import { ConversationCore, type ConversationCoreOptions } from "../core.js";
import { openCoreStorage } from "../storage/core-storage.js";
import type { ModelPort, ToolHostPort } from "../ports.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function waitUntil(predicate: () => boolean) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (predicate()) return;
    await delay(5);
  }
  throw new Error("Timed out waiting for core state");
}
function options(
  dataDir: string,
  database: string,
  models: ModelPort,
  host: ToolHostPort,
): ConversationCoreOptions {
  const unexpectedProcess = async (): Promise<never> => {
    throw new Error("No process expected");
  };
  return {
    storage: openCoreStorage(database),
    dataDir,
    models,
    toolHost: host,
    turnResources: {
      prepare: async () => ({ systemPrompt: "Test", tools: [] }),
    },
    permissions: {
      evaluate: async ({ toolName }) => ({
        decision: toolName === "write" ? "approval" : "allow",
        suggestedRules: [],
        authority: null,
      }),
      addRule: async () => {},
    },
    processes: {
      start: unexpectedProcess,
      run: unexpectedProcess,
      reattach: async () => null,
    },
    defaultConfig: () => ({
      model: { provider: "test", modelId: "test" },
      reasoningLevel: "off",
      systemPrompt: null,
      permissionRuleSetId: "baseline",
      mode: "coding",

      workingDirectory: dataDir,
    }),
  };
}
async function createConversation(core: ConversationCore, id: string) {
  if (!core.projects.get("proj_test"))
    core.projects.create({
      id: "proj_test",
      name: "Test",
      directory: tmpdir(),
    });
  await core.createConversation({ id, projectId: "proj_test" });
}

void test(
  "shutdown preserves execution and interactions for recovery and fences late workers",
  { timeout: 5000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "nerve-shutdown-"));
    const database = join(directory, "core.sqlite");
    const provider = registerAgentScriptedProvider({
      provider: `lifecycle-${randomUUID()}`,
      model: "test",
      steps: [
        {
          type: "toolCalls",
          calls: [
            {
              id: "provider_write",
              name: "write",
              args: { path: "pending.txt", content: "pending" },
            },
            {
              id: "provider_question",
              name: "ask_user",
              args: { question: "Which option?" },
            },
            {
              id: "provider_success",
              name: "bash",
              args: { command: "late success" },
            },
            {
              id: "provider_failure",
              name: "bash",
              args: { command: "late failure" },
            },
          ],
        },
        { type: "waitForAbort" },
      ],
    });
    const success = deferred<void>();
    const failure = deferred<void>();
    const signals: AbortSignal[] = [];
    const models: ModelPort = {
      resolve: async () => {
        const model = provider.getModel("test");
        if (!model) throw new Error("Missing scripted model");
        return { model };
      },
    };
    const host: ToolHostPort = {
      execute: async ({ args, signal, onProgress }) => {
        signals.push(signal);
        await ((args as { command: string }).command === "late success"
          ? success.promise
          : failure.promise);
        onProgress({ chunk: "late progress" });
        return { kind: "completed", result: { content: "late result" } };
      },
      isReplaySafe: () => false,
    };
    let core = new ConversationCore(options(directory, database, models, host));
    try {
      await core.start();
      await createConversation(core, "conv_tools");
      core.submitInput({
        conversationId: "conv_tools",
        inputId: "input_tools",
        text: "Use tools",
        source: "user",
      });
      await waitUntil(
        () =>
          signals.length === 2 &&
          core
            .getSnapshot("conv_tools")
            .toolCalls.some((call) => call.state === "awaiting_input"),
      );
      await createConversation(core, "conv_model");
      core.submitInput({
        conversationId: "conv_model",
        inputId: "input_model",
        text: "Stream until stopped",
        source: "user",
      });
      await waitUntil(
        () => core.getSnapshot("conv_model").conversation.status === "running",
      );
      await delay(10);
      const beforeTools = core.getEventsSince("conv_tools", 0);
      const beforeModel = core.getEventsSince("conv_model", 0);
      const beforeRows = core.getSnapshot("conv_tools").toolCalls;
      assert.deepEqual(beforeRows.map((call) => call.state).sort(), [
        "awaiting_approval",
        "awaiting_input",
        "running",
        "running",
      ]);
      await core.close();
      assert.equal(
        signals.every((signal) => signal.aborted),
        true,
      );
      // These deliberately uncooperative workers finish after SQLite is closed.
      success.resolve();
      failure.reject(new Error("late host failure"));
      await delay(10);
      const recoveryOptions = options(
        directory,
        database,
        {
          resolve: async () => {
            throw new Error("Recovery must not call providers");
          },
        },
        host,
      );
      core = new ConversationCore(recoveryOptions);
      assert.deepEqual(core.getEventsSince("conv_tools", 0), beforeTools);
      assert.deepEqual(core.getEventsSince("conv_model", 0), beforeModel);
      assert.deepEqual(core.getSnapshot("conv_tools").toolCalls, beforeRows);
      await core.start();
      assert.deepEqual(
        core
          .getSnapshot("conv_tools")
          .toolCalls.map((call) => call.state)
          .sort(),
        ["awaiting_approval", "awaiting_input"],
      );
      const responses = core
        .getEventsSince("conv_tools", 0)
        .filter((event) => event.type === "tool_call_response");
      assert.equal(responses.length, 2);
      assert.equal(
        responses.every(
          (event) =>
            event.type === "tool_call_response" &&
            event.payload.outcome === "indeterminate",
        ),
        true,
      );
      assert.equal(
        core.getSnapshot("conv_tools").conversation.status,
        "waiting",
      );
      assert.equal(
        core.getSnapshot("conv_model").conversation.status,
        "interrupted",
      );
      assert.equal(core.getSnapshot("conv_model").conversation.paused, false);
    } finally {
      success.resolve();
      failure.resolve();
      await core.close();
      provider.unregister();
      await rm(directory, { recursive: true, force: true });
    }
  },
);

void test(
  "approval acknowledges durable resolution before execution and records background failures",
  { timeout: 5000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "nerve-approval-"));
    const execution = deferred<void>();
    const started = deferred<void>();
    let executions = 0;
    const config = options(
      directory,
      ":memory:",
      {
        resolve: async () => {
          throw new Error("Inline commands must not call a provider");
        },
      },
      {
        execute: async () => {
          executions++;
          started.resolve();
          await execution.promise;
          return { kind: "completed", result: { content: "done" } };
        },
        isReplaySafe: () => false,
      },
    );
    config.permissions.evaluate = async () => ({
      decision: "approval",
      suggestedRules: [],
      authority: null,
    });
    const core = new ConversationCore(config);
    try {
      await core.start();
      await createConversation(core, "conv_approval");
      await core.submitInput({
        conversationId: "conv_approval",
        inputId: "input_approval",
        text: "!long command",
        source: "user",
      });
      const call = core.getSnapshot("conv_approval").toolCalls[0];
      assert.equal(call.state, "awaiting_approval");
      const resolution = {
        toolCallId: call.id,
        resolutionRequestId: "resolution_test",
        resolution: { kind: "approval", decision: "approve" },
      } as const;
      let acknowledged = false;
      const acknowledgement = core.resolveInteraction(resolution).then(() => {
        acknowledged = true;
      });
      await waitUntil(() => acknowledged);
      await acknowledgement;
      assert.equal(
        config.storage.toolCalls.get(call.id)?.interaction?.resolutionRequestId,
        "resolution_test",
      );
      assert.equal(config.storage.events.findByInputId("input_approval"), null);
      await core.resolveInteraction(resolution);
      await started.promise;
      assert.equal(executions, 1);
      const response = deferred<ConversationEvent>();
      const unsubscribe = core.subscribe((change) => {
        if (
          change.kind === "event_appended" &&
          change.event.type === "tool_call_response"
        )
          response.resolve(change.event);
      });
      execution.reject(new Error("Approved execution failed"));
      const event = await response.promise;
      unsubscribe();
      assert.equal(event.type, "tool_call_response");
      if (event.type !== "tool_call_response")
        throw new Error("Missing response");
      assert.equal(event.payload.outcome, "failed");
      assert.equal(event.payload.resolutionRequestId, "resolution_test");
      assert.equal(event.inputId, "input_approval");
      assert.equal(config.storage.toolCalls.get(call.id), null);
    } finally {
      execution.resolve();
      await core.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
