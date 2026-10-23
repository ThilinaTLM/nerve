import { configureTest } from "./lifecycle-test-helpers.js";
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
import type { CoreChange } from "./core-change.js";
import { ConversationCore } from "../core.js";
import {
  createConversation,
  options,
  waitUntil,
} from "./lifecycle-test-helpers.js";

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

for (const stop of [false, true]) {
  void test(
    `manual retry preserves prepared context, fences hung output; stop=${stop}`,
    { timeout: 5000 },
    async () => {
      const directory = await mkdtemp(join(tmpdir(), "nerve-manual-retry-"));
      const provider = registerAgentScriptedProvider({
        provider: `retry-${randomUUID()}`,
        model: "test",
        steps: [
          {
            type: "toolCalls",
            calls: [{ id: "call", name: "bash", args: { command: "once" } }],
          },
          { type: "assistantText", text: "Done" },
        ],
      });
      let resolutions = 0;
      let preparations = 0;
      let executions = 0;
      const tool = deferred();
      const late = deferred();
      const opts = options(
        directory,
        join(directory, "core.sqlite"),
        {
          resolve: async () => {
            resolutions++;
            return { model: provider.getModel("test")! };
          },
        },
        {
          execute: async () => {
            executions++;
            await tool.promise;
            return { kind: "completed", result: { content: "Executed" } };
          },
          isReplaySafe: () => false,
        },
      );
      opts.turnResources.prepare = async () => {
        preparations++;
        return { systemPrompt: "Captured", tools: [] };
      };
      const core = new ConversationCore(opts);
      const changes: CoreChange[] = [];
      core.subscribe((change) => changes.push(change));
      const registry = getModelRegistry();
      const original = registry.streamSimple;
      const requests: Parameters<typeof original>[] = [];
      const stream = mock.method(
        registry,
        "streamSimple",
        (...args: Parameters<typeof original>) => {
          requests.push(args);
          if (requests.length > 1) return original.apply(registry, args);
          // Deliberately ignore abort and remain hung until after retry/stop.
          return {
            async *[Symbol.asyncIterator]() {
              yield { type: "text_delta", contentIndex: 0, delta: "old" };
              await late.promise;
              yield { type: "text_delta", contentIndex: 0, delta: "late" };
              yield {
                type: "toolcall_delta",
                contentIndex: 1,
                delta: "stale",
                partial: {
                  content: [
                    null,
                    { type: "toolCall", id: "stale", name: "bash" },
                  ],
                },
              };
            },
            result: async () => {
              throw new Error("Late result must be ignored");
            },
          } as unknown as ReturnType<typeof original>;
        },
      );
      try {
        await core.start();
        await createConversation(core, "conv");
        assert.throws(
          () => core.retryResponse("conv"),
          /No active provider request/,
        );
        core.submitInput({
          conversationId: "conv",
          inputId: "input",
          source: "user",
          text: "Do it",
        });
        await waitUntil(() =>
          changes.some(
            (c) => c.kind === "live" && c.delta.type === "assistant_text",
          ),
        );
        const first = requests[0]!;
        configureTest(opts, core, "conv", {
          instructions: "Changed while pending",
          systemPrompt: "New prompt",
          reasoningLevel: "high",
        });
        core.retryResponse("conv");
        core.retryResponse("conv"); // Concurrent duplicates coalesce, not queue.
        assert.equal(first[2]!.signal!.aborted, true);
        if (stop) {
          await core.stop("conv");
          late.resolve();
          await new Promise<void>((resolve) => setImmediate(resolve));
          assert.equal(requests.length, 1);
          assert.equal(executions, 0);
        } else {
          await waitUntil(() => executions === 1);
          assert.equal(requests.length, 2);
          assert.equal(resolutions, 1);
          assert.equal(preparations, 1);
          assert.equal(requests[1]![1], first[1]);
          assert.equal(requests[1]![0], first[0]);
          assert.equal(requests[1]![2]!.reasoning, first[2]!.reasoning);
          assert.throws(
            () => core.retryResponse("conv"),
            /No active provider request/,
          );
          late.resolve();
          await new Promise<void>((resolve) => setImmediate(resolve));
          tool.resolve();
          await waitUntil(
            () => core.getSnapshot("conv").conversation.status !== "running",
          );
          assert.equal(executions, 1);
          assert.equal(requests.length, 3);
          const resets = changes.filter(
            (c) => c.kind === "live" && c.delta.type === "assistant_reset",
          );
          assert.equal(resets.length, 1);
        }
        assert.equal(
          changes.filter(
            (c) =>
              c.kind === "event_appended" && c.event.type === "user_message",
          ).length,
          1,
        );
        assert.equal(
          changes.some(
            (c) =>
              c.kind === "live" &&
              ((c.delta.type === "assistant_text" &&
                c.delta.delta === "late") ||
                (c.delta.type === "tool_call_arguments" &&
                  c.delta.providerCallId === "stale")),
          ),
          false,
        );
        assert.throws(
          () => core.retryResponse("conv"),
          /No active provider request/,
        );
      } finally {
        late.resolve();
        tool.resolve();
        await core.close();
        stream.mock.restore();
        provider.unregister();
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
}
