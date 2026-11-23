import assert from "node:assert/strict";
import test from "node:test";
import { createTextHost } from "./text-models.js";

const resolved = (reasoning: boolean) => ({
  model: { reasoning } as never,
  apiKey: "key",
});

function host(options: { reasoning?: boolean } = {}) {
  const calls: { selection: unknown; options: Record<string, unknown> }[] = [];
  const textHost = createTextHost({
    models: {
      resolve: async (selection) => {
        if (selection.modelId === "missing") throw new Error("no credentials");
        calls.push({ selection, options: {} });
        return resolved(options.reasoning ?? true);
      },
    },
    configuration: () => ({ models: [], providers: [] }) as never,
    agents: () =>
      ({
        captureDefaults: async (projectId: string) => ({
          options:
            projectId === "project"
              ? {
                  user: {
                    model: { provider: "p", modelId: "default" },
                    reasoningLevel: "high",
                  },
                }
              : {},
        }),
      }) as never,
    stream: ((_model: unknown, context: unknown, streamOptions: never) => {
      calls.at(-1)!.options = { ...(streamOptions as object), context };
      const events = [
        { type: "thinking_delta", delta: "hm" },
        { type: "text_delta", delta: "ok" },
      ];
      return {
        async *[Symbol.asyncIterator]() {
          yield* events;
        },
        result: async () => ({
          stopReason: "stop",
          content: [{ type: "text", text: " ok " }],
        }),
      };
    }) as never,
  });
  return { textHost, calls };
}

void test("the request's model and reasoning level run", async () => {
  const { textHost, calls } = host();
  const deltas: string[] = [];
  const model = {
    provider: "q",
    modelId: "chosen",
    reasoningLevel: "low",
  } as const;
  const result = await textHost.complete({
    model,
    system: "be brief",
    prompt: "hi",
    maxTokens: 50,
    onDelta: ({ kind, delta }) => deltas.push(`${kind}:${delta}`),
  });
  assert.deepEqual(result, { text: "ok", model: "q/chosen" });
  assert.deepEqual(deltas, ["thinking:hm", "text:ok"]);
  assert.equal(calls[0].options.reasoning, "low");
  assert.equal(calls[0].options.maxTokens, 50);
  assert.equal(
    (calls[0].options.context as { systemPrompt: string }).systemPrompt,
    "be brief",
  );
  assert.equal(await textHost.ready(model), true);
});

void test("reasoning is left off for a model without it", async () => {
  const { textHost, calls } = host({ reasoning: false });
  await textHost.complete({
    model: { provider: "q", modelId: "m", reasoningLevel: "high" },
    prompt: "hi",
  });
  assert.equal("reasoning" in calls[0].options, false);
});

void test("an unusable model is not ready and denies the call", async () => {
  const { textHost } = host();
  const model = { provider: "q", modelId: "missing" };
  assert.equal(await textHost.ready(model), false);
  await assert.rejects(
    textHost.complete({ model, prompt: "hi" }),
    (error: { code?: string }) => error.code === "DENIED",
  );
});

void test("defaultModel is the project's lead model and reasoning level", async () => {
  const { textHost } = host();
  assert.deepEqual(await textHost.defaultModel("project"), {
    provider: "p",
    modelId: "default",
    reasoningLevel: "high",
  });
  assert.equal(await textHost.defaultModel("other"), undefined);
});
