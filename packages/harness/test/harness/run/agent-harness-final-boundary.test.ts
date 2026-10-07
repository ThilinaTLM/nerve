import assert from "node:assert/strict";
import test from "node:test";
import { AgentHarness } from "../../../src/harness/agent-harness.js";
import { Conversation } from "../../../src/conversation/conversation.js";
import { InMemoryConversationStorage } from "../../../src/conversation/adapters/in-memory-storage.js";
import type {
  AgentLoopConfig,
  AnyModel,
  PrepareNextTurnContext,
} from "../../../src/agent/contracts/index.js";

const model = {
  id: "test",
  provider: "test",
  api: "test",
  name: "test",
  baseUrl: "",
  reasoning: false,
  input: ["text"],
  contextWindow: 100,
  maxTokens: 10,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
} as AnyModel;

test("a configuration-only edit after a final response cannot fail an otherwise completed run", async () => {
  let pendingInput = false;
  let preparations = 0;
  const harness = new AgentHarness({
    model,
    env: {} as never,
    conversation: new Conversation(new InMemoryConversationStorage()),
    hasPendingTurnInput: async () => pendingInput,
    prepareTurn: async () => {
      preparations++;
      throw new Error("unsupported next configuration");
    },
  });
  const internal = harness as unknown as {
    createLoopConfig(
      getState: () => unknown,
      setState: (state: unknown) => void,
    ): AgentLoopConfig;
  };
  const config = internal.createLoopConfig(
    () => ({ model, thinkingLevel: "off" }),
    () => undefined,
  );
  const boundary = {
    hasMoreToolCalls: false,
    message: { role: "assistant" },
    toolResults: [],
    context: { systemPrompt: "", messages: [], tools: [] },
    newMessages: [],
  } as unknown as PrepareNextTurnContext;
  assert.equal(await config.prepareNextTurn?.(boundary), undefined);
  assert.equal(preparations, 0);
  pendingInput = true;
  await assert.rejects(
    async () => config.prepareNextTurn?.(boundary),
    /unsupported next configuration/,
  );
  assert.equal(preparations, 1);
});
