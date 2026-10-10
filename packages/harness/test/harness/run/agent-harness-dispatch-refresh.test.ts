import assert from "node:assert/strict";
import test from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { AgentHarness } from "../../../src/harness/agent-harness.js";
import { Conversation } from "../../../src/conversation/conversation.js";
import { InMemoryConversationStorage } from "../../../src/conversation/adapters/in-memory-storage.js";
import {
  registerManagedFauxProvider,
  getRegisteredModels,
} from "../../../src/models/model-registry.js";

for (const mode of ["prompt", "continue"] as const) {
  test(`${mode}: held credentials supersede a candidate without dispatch or duplicated input events`, async () => {
    const oldModel = getRegisteredModels("openai")[0]!;
    const nextModel = getRegisteredModels("anthropic").find(
      (model) => model.reasoning,
    )!;
    assert.ok(nextModel);
    const conversation = new Conversation(new InMemoryConversationStorage());
    let releaseAuth!: () => void;
    let authStarted!: () => void;
    const heldAuth = new Promise<void>((resolve) => {
      releaseAuth = resolve;
    });
    const started = new Promise<void>((resolve) => {
      authStarted = resolve;
    });
    let revision = 0;
    let preparedRevision = 0;
    const preparations: boolean[] = [];
    const authModels: string[] = [];
    const order: string[] = [];
    const events: string[] = [];
    const requests: { payload: unknown; headers: Headers }[] = [];
    const fetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      const body =
        options?.body ??
        (url instanceof Request ? await url.clone().text() : "");
      requests.push({
        payload: JSON.parse(String(body)),
        headers: new Headers(
          options?.headers ??
            (url instanceof Request ? url.headers : undefined),
        ),
      });
      return new Response(
        JSON.stringify({
          type: "error",
          error: { type: "invalid_request_error", message: "offline boundary" },
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      );
    };
    try {
      const harness = new AgentHarness({
        model: oldModel,
        conversation,
        env: {} as never,
        streamOptions: { maxRetries: 0 },
        prepareTurn: async ({ refresh }) => {
          preparations.push(refresh);
          preparedRevision = revision;
          return {
            model: revision ? nextModel : oldModel,
            thinkingLevel: revision ? "high" : "off",
            tools: [
              {
                name: revision ? "new_tool" : "old_tool",
                label: "test",
                description: "test tool",
                parameters: Type.Object({}),
                execute: async () => ({ content: [], details: {} }),
              },
            ],
            activeToolNames: [revision ? "new_tool" : "old_tool"],
            resources: {},
            systemPrompt: revision ? "fresh prompt" : "stale prompt",
          };
        },
        getApiKeyAndHeaders: async (model) => {
          authModels.push(model.provider);
          order.push(`auth:${model.provider}`);
          if (authModels.length === 1) {
            authStarted();
            await heldAuth;
          }
          return {
            apiKey: `key-${model.provider}`,
            headers: { "x-auth-candidate": model.provider },
            env: { CANDIDATE: model.provider },
            baseUrl: model.baseUrl,
          };
        },
        beforeProviderDispatch: async () => {
          order.push(`claim:${preparedRevision}`);
          return preparedRevision === revision
            ? { kind: "ready" }
            : { kind: "refresh" };
        },
      });
      harness.on("before_agent_start", async () => ({
        systemPrompt: "required hook instruction",
      }));
      harness.on("before_provider_request", async () => {
        await Promise.resolve();
        order.push("legacy-hook");
        return { streamOptions: { headers: { "x-legacy": "awaited" } } };
      });
      harness.subscribe((event) => {
        events.push(
          event.type === "message_end"
            ? `message_end:${event.message.role}`
            : event.type,
        );
      });
      const image = {
        type: "image" as const,
        mimeType: "image/png",
        data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
      };
      if (mode === "prompt") {
        await harness.nextTurn("queued input", { images: [image] });
      } else {
        for (const text of ["queued input", "original input"]) {
          await conversation.appendMessage({
            role: "user",
            content: [{ type: "text", text }, image],
            timestamp: Date.now(),
          });
        }
      }
      const result =
        mode === "prompt"
          ? harness.prompt("original input", { images: [image] })
          : harness.continue();
      await started;
      assert.equal(requests.length, 0);
      revision = 1;
      releaseAuth();
      await result;
      assert.deepEqual(preparations, [false, true]);
      assert.deepEqual(authModels, [oldModel.provider, nextModel.provider]);
      assert.deepEqual(order, [
        `auth:${oldModel.provider}`,
        "legacy-hook",
        "claim:0",
        `auth:${nextModel.provider}`,
        "legacy-hook",
        "claim:1",
      ]);
      assert.equal(requests.length, 1);
      const serialized = JSON.stringify(requests[0]!.payload);
      assert.match(
        serialized,
        mode === "prompt" ? /required hook instruction/ : /fresh prompt/,
      );
      assert.match(serialized, /original input/);
      assert.match(serialized, /queued input/);
      assert.equal(serialized.split(image.data).length - 1, 2);
      assert.match(serialized, /new_tool/);
      assert.match(serialized, /thinking/);
      assert.doesNotMatch(serialized, /stale prompt|old_tool/);
      assert.equal(
        requests[0]!.headers.get("x-auth-candidate"),
        nextModel.provider,
      );
      assert.equal(requests[0]!.headers.get("x-legacy"), "awaited");
      assert.equal(events.filter((event) => event === "turn_start").length, 1);
      assert.equal(
        events.filter((event) => event === "message_end:user").length,
        mode === "prompt" ? 2 : 0,
      );
      assert.equal(
        events.filter((event) => event === "message_end:assistant").length,
        1,
      );
    } finally {
      releaseAuth?.();
      globalThis.fetch = fetch;
    }
  });
}

test("credential failures remain ordinary assistant errors and never claim dispatch", async () => {
  let claims = 0;
  const harness = new AgentHarness({
    model: getRegisteredModels("openai")[0]!,
    conversation: new Conversation(new InMemoryConversationStorage()),
    env: {} as never,
    getApiKeyAndHeaders: async () => {
      throw new Error("credentials unavailable");
    },
    beforeProviderDispatch: async () => {
      claims++;
      return { kind: "ready" };
    },
  });
  const result = await harness.prompt("hello");
  assert.equal(result.stopReason, "error");
  assert.match(result.errorMessage ?? "", /credentials unavailable/);
  assert.equal(claims, 0);
});

test("a failing dispatch callback remains an ordinary run failure", async () => {
  const harness = new AgentHarness({
    model: getRegisteredModels("openai")[0]!,
    conversation: new Conversation(new InMemoryConversationStorage()),
    env: {} as never,
    getApiKeyAndHeaders: async () => ({ apiKey: "unused" }),
    beforeProviderDispatch: async () => {
      throw new Error("dispatch unavailable");
    },
  });
  const result = await harness.prompt("hello");
  assert.equal(result.stopReason, "error");
  assert.match(result.errorMessage ?? "", /dispatch unavailable/);
});

test("unbounded refresh callback churn becomes a normal failure, not a phantom request", async () => {
  let claims = 0;
  const model = getRegisteredModels("openai")[0]!;
  const harness = new AgentHarness({
    model,
    conversation: new Conversation(new InMemoryConversationStorage()),
    env: {} as never,
    prepareTurn: async () => ({
      model,
      thinkingLevel: "off",
      tools: [],
      activeToolNames: [],
      resources: {},
      systemPrompt: "",
    }),
    getApiKeyAndHeaders: async () => ({ apiKey: "unused" }),
    beforeProviderDispatch: async () => {
      claims++;
      return { kind: "refresh" };
    },
  });
  const events: string[] = [];
  harness.subscribe((event) => {
    if (event.type === "message_end") events.push(event.message.role);
  });
  const result = await harness.prompt("hello");
  assert.equal(result.stopReason, "error");
  assert.match(result.errorMessage ?? "", /exceeded refresh limit/);
  assert.equal(claims, 65);
  assert.deepEqual(events, ["user", "assistant"]);
});

test("initial hook prompt survives same-invocation refresh but not the next prepared turn", async () => {
  const provider = "nerve-hook-prompt-refresh";
  const registration = registerManagedFauxProvider({
    provider,
    models: [{ id: "test", name: "test" }],
    tokensPerSecond: 10_000,
  });
  const prompts: string[] = [];
  registration.setResponses([
    async (context) => {
      prompts.push(
        String(
          context.messages.find((message) => message.role === "system")
            ?.content ?? "",
        ),
      );
      return fauxAssistantMessage([fauxToolCall("read", {}, { id: "read_1" })]);
    },
    async (context) => {
      prompts.push(
        String(
          context.messages.find((message) => message.role === "system")
            ?.content ?? "",
        ),
      );
      return fauxAssistantMessage("done");
    },
  ]);
  const model = registration.getModel("test")!;
  let normalTurns = 0;
  let claims = 0;
  let authCalls = 0;
  let startHooks = 0;
  const preparations: boolean[] = [];
  const harness = new AgentHarness({
    model,
    env: {} as never,
    conversation: new Conversation(new InMemoryConversationStorage()),
    hasPendingTurnInput: async () => false,
    prepareTurn: async ({ refresh }) => {
      preparations.push(refresh);
      if (!refresh) normalTurns++;
      return {
        model,
        thinkingLevel: "off",
        resources: {},
        tools: [
          {
            name: "read",
            label: "read",
            description: "read",
            parameters: Type.Object({}),
            execute: async () => ({
              content: [{ type: "text", text: "read result" }],
              details: {},
            }),
          },
        ],
        activeToolNames: ["read"],
        systemPrompt: `prepared turn ${normalTurns}${refresh ? " refreshed" : ""}`,
      };
    },
    getApiKeyAndHeaders: async () => {
      authCalls++;
      return { apiKey: "test" };
    },
    beforeProviderDispatch: async () =>
      ++claims % 2 ? { kind: "refresh" } : { kind: "ready" },
  });
  harness.on("before_agent_start", async () => {
    startHooks++;
    return { systemPrompt: "required hook instruction" };
  });
  try {
    const result = await harness.prompt("read then finish");
    assert.equal(result.stopReason, "stop");
    assert.deepEqual(prompts, [
      "required hook instruction",
      "prepared turn 2 refreshed",
    ]);
    assert.deepEqual(preparations, [false, true, false, true]);
    assert.equal(authCalls, 4);
    assert.equal(startHooks, 1);
  } finally {
    registration.unregister();
  }
});
