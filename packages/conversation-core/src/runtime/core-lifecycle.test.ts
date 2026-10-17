import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { registerAgentScriptedProvider } from "@nervekit/harness/models";
import type { ConversationEvent } from "@nervekit/contracts/core";
import { ConversationCore } from "../core.js";
import {
  waitUntil,
  options,
  createConversation,
} from "./lifecycle-test-helpers.js";
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
      for (const response of responses) {
        const running = beforeRows.find(
          (row) => row.id === response.payload.toolCallId,
        )!;
        assert.equal(response.payload.startedAt, running.updatedAt);
      }
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
    let emitProgress: (() => void) | undefined;
    const config = options(
      directory,
      ":memory:",
      {
        resolve: async () => {
          throw new Error("Inline commands must not call a provider");
        },
      },
      {
        execute: async ({ onProgress }) => {
          emitProgress = () => onProgress({ chunk: "still running" });
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
      effectiveRisk: "destructive",
      reason: "Destructive command needs review",
      matchedRule: { id: "review_commands" },
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
      const running = config.storage.toolCalls.get(call.id)!;
      assert.equal(running.state, "running");
      emitProgress!();
      assert.equal(
        config.storage.toolCalls.get(call.id)?.updatedAt,
        running.updatedAt,
      );
      assert.equal(running.supervision?.effectiveRisk, "destructive");
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
      assert.equal(event.payload.startedAt, running.updatedAt);
      assert.deepEqual(event.payload.supervision, {
        decision: "approval",
        effectiveRisk: "destructive",
        reason: "Destructive command needs review",
        matchedRule: { id: "review_commands" },
        suggestedRules: [],
        authority: null,
      });
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

for (const action of ["stop", "forcePush"] as const) {
  void test(
    `${action} owns cancellation despite delayed and uncooperative workers`,
    { timeout: 5000 },
    async () => {
      const directory = await mkdtemp(join(tmpdir(), "nerve-cancel-"));
      const gates = new Map(
        ["success", "failure", "ack", "background"].map((name) => [
          name,
          deferred<void>(),
        ]),
      );
      const signals: AbortSignal[] = [];
      let backgroundCancelled = false;
      let progress = 0;
      const provider = registerAgentScriptedProvider({
        provider: `cancel-${randomUUID()}`,
        model: "test",
        steps: [
          {
            type: "toolCalls",
            calls: [
              {
                id: "approval",
                name: "write",
                args: { path: "pending.txt", content: "pending" },
              },
              {
                id: "question",
                name: "ask_user",
                args: { question: "Which option?" },
              },
              ...[...gates.keys()].map((command) => ({
                id: command,
                name: "bash",
                args: { command },
              })),
            ],
          },
        ],
      });
      const config = options(
        directory,
        ":memory:",
        {
          resolve: async () => {
            const model = provider.getModel("test");
            if (!model) throw new Error("Missing scripted model");
            return { model };
          },
        },
        {
          execute: async ({ args, signal, onProgress }) => {
            signals.push(signal);
            const command = String((args as { command: string }).command);
            await gates.get(command)!.promise;
            onProgress({ chunk: "late progress" });
            if (command === "ack")
              throw Object.assign(new Error("Process cancelled"), {
                name: "AbortError",
              });
            if (command === "background")
              return {
                kind: "backgrounded",
                result: { content: "late background" },
                process: {
                  ref: "late-process",
                  outputFiles: { stdout: "unused", stderr: "unused" },
                  wait: async () => ({ exitCode: null, status: "cancelled" }),
                  cancel: async () => {
                    backgroundCancelled = true;
                  },
                },
              };
            return { kind: "completed", result: { content: "late success" } };
          },
          isReplaySafe: () => false,
        },
      );
      const core = new ConversationCore(config);
      const unsubscribe = core.subscribe((change) => {
        if (change.kind === "live" && change.delta.type === "tool_progress")
          progress++;
      });
      try {
        await core.start();
        await createConversation(core, "conv_cancel");
        core.submitInput({
          conversationId: "conv_cancel",
          inputId: "input_cancel",
          text: "Use tools",
          source: "user",
        });
        await waitUntil(
          () =>
            signals.length === 4 &&
            core
              .getSnapshot("conv_cancel")
              .toolCalls.filter((call) => call.state.startsWith("awaiting_"))
              .length === 2,
        );
        await core[action]("conv_cancel");
        assert.ok(signals.every((signal) => signal.aborted));
        assert.equal(core.getSnapshot("conv_cancel").toolCalls.length, 0);
        const responses = core
          .getEventsSince("conv_cancel", 0)
          .filter((event) => event.type === "tool_call_response");
        assert.equal(responses.length, 6);
        assert.equal(
          new Set(responses.map((event) => event.payload.toolCallId)).size,
          6,
        );
        assert.ok(
          responses.every((event) => event.payload.outcome !== "indeterminate"),
        );
        for (const event of responses) {
          assert.equal(
            event.payload.startedAt !== undefined,
            event.payload.toolName !== "write",
          );
          assert.equal(event.payload.outcome, "cancelled");
          const stored = config.storage.events
            .since("conv_cancel", 0)
            .find((stored) => stored.id === event.id);
          assert.ok(stored?.type === "tool_call_response");
          const text = stored.payload.agentProjection
            .filter((block) => block.type === "text")
            .map((block) => block.text)
            .join("\n");
          assert.match(
            text,
            /Tool execution was cancelled\. No rollback is implied\./,
          );
          assert.match(text, /Effects already performed are not undone\./);
          assert.match(
            text,
            action === "stop"
              ? /cancelled by the user/
              : /cancelled for a replacement prompt/,
          );
          if (action === "forcePush")
            assert.doesNotMatch(text, /cancelled by the user/);
        }
        gates.get("failure")!.reject(new Error("late failure"));
        for (const [name, gate] of gates)
          if (name !== "failure") gate.resolve();
        await waitUntil(() => backgroundCancelled);
        await delay(20);
        assert.equal(progress, 0);
        assert.deepEqual(
          core
            .getEventsSince("conv_cancel", 0)
            .filter((event) => event.type === "tool_call_response"),
          responses,
        );
      } finally {
        for (const gate of gates.values()) gate.resolve();
        unsubscribe();
        await core.close();
        provider.unregister();
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
}

void test(
  "Stop preserves a completion whose settlement already began",
  { timeout: 5000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "nerve-settling-"));
    const writing = deferred<void>();
    const release = deferred<void>();
    const core = new ConversationCore(
      options(
        directory,
        ":memory:",
        {
          resolve: async () => {
            throw new Error("Inline command must not call a provider");
          },
        },
        {
          execute: async () => ({
            kind: "completed",
            result: { content: "owned completion" },
          }),
          isReplaySafe: () => false,
        },
      ),
    );
    const write = core.assets.write.bind(core.assets);
    core.assets.write = async (input) => {
      writing.resolve();
      await release.promise;
      return write(input);
    };
    try {
      await core.start();
      await createConversation(core, "conv_settling");
      const submission = core.submitInput({
        conversationId: "conv_settling",
        inputId: "input_settling",
        text: "!command",
        source: "user",
      });
      await writing.promise;
      const stopped = core.stop("conv_settling");
      release.resolve();
      await Promise.all([submission, stopped]);
      const responses = core
        .getEventsSince("conv_settling", 0)
        .filter((event) => event.type === "tool_call_response");
      assert.equal(responses.length, 1);
      assert.equal(responses[0].payload.outcome, "completed");
      assert.equal(core.getSnapshot("conv_settling").toolCalls.length, 0);
    } finally {
      release.resolve();
      await core.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);

void test(
  "forcePush cleans up a background process when pending adoption rejects late",
  { timeout: 5000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "nerve-adoption-"));
    const adopting = deferred<void>();
    const adoption = deferred<never>();
    let cancelled = false;
    let progress = 0;
    const config = options(
      directory,
      ":memory:",
      {
        resolve: async () => {
          throw new Error("Inline command must not call a provider");
        },
      },
      {
        execute: async ({ onProgress }) => {
          void adoption.promise.catch(() =>
            onProgress({ chunk: "late progress" }),
          );
          return {
            kind: "backgrounded",
            result: { content: "background" },
            process: {
              ref: "pending-adoption",
              outputFiles: { stdout: "unused", stderr: "unused" },
              wait: async () => ({ exitCode: null, status: "cancelled" }),
              cancel: async () => {
                cancelled = true;
              },
            },
          };
        },
        isReplaySafe: () => false,
      },
    );
    const core = new ConversationCore(config);
    core.asyncBash.adopt = async () => {
      adopting.resolve();
      return adoption.promise;
    };
    const unsubscribe = core.subscribe((change) => {
      if (change.kind === "live" && change.delta.type === "tool_progress")
        progress++;
    });
    try {
      await core.start();
      await createConversation(core, "conv_adoption");
      const submission = core.submitInput({
        conversationId: "conv_adoption",
        inputId: "input_adoption",
        text: "!command",
        source: "user",
      });
      await adopting.promise;
      await core.forcePush("conv_adoption");
      assert.equal(core.getSnapshot("conv_adoption").toolCalls.length, 0);
      adoption.reject(new Error("late adoption failure"));
      await submission;
      await waitUntil(() => cancelled);
      assert.equal(progress, 0);
      const responses = config.storage.events
        .since("conv_adoption", 0)
        .filter((event) => event.type === "tool_call_response");
      assert.equal(responses.length, 1);
      assert.equal(responses[0].payload.outcome, "cancelled");
    } finally {
      adoption.reject(new Error("test cleanup"));
      unsubscribe();
      await core.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
