import assert from "node:assert/strict";
import { test } from "node:test";
import {
  validateAsyncBashArguments,
  createAsyncBashTools,
} from "./async-bash-tools.js";
import type { ConversationCore } from "../core.js";

void test("async bash validates exactly the arguments for each action", () => {
  for (const args of [
    { action: "list" },
    { action: "list", all: true },
    { action: "logs", id: "bash_1", offset: 0, limit: 500 },
    { action: "stop", id: "bash_1" },
  ])
    assert.doesNotThrow(() => validateAsyncBashArguments(args));
  for (const args of [
    { action: "wait" },
    { action: "logs" },
    { action: "logs", id: "bash_1", offset: -1 },
    { action: "logs", id: "bash_1", limit: 501 },
    { action: "stop", id: "bash_1", limit: 1 },
    { action: "list", id: "bash_1" },
  ])
    assert.throws(() => validateAsyncBashArguments(args));
});
void test("async bash actions enforce ownership and format running lists", async () => {
  const row = {
    id: "bash_1",
    status: "running",
    exitCode: null,
    command: "echo hi",
    startedAt: new Date(Date.now() - 1000).toISOString(),
    finishedAt: null,
  };
  let stopped = "";
  const core = {
    asyncBash: { list: () => [row], logs: async () => "page" },
    cancelAsyncBash: async (id: string) => {
      stopped = id;
    },
  } as unknown as ConversationCore;
  const tool = createAsyncBashTools(core)[0]!;
  const execute = (args: Record<string, unknown>) =>
    tool.execute(
      { conversationId: "conv", arguments: args } as Parameters<
        typeof tool.execute
      >[0],
      {} as Parameters<typeof tool.execute>[1],
    );
  const list = await execute({ action: "list" });
  assert.equal(list.kind, "completed");
  if (list.kind === "completed")
    assert.match(String(list.result.content), /^bash_1 running \d+s echo hi$/);
  await assert.rejects(
    execute({ action: "logs", id: "foreign" }),
    /Owned async bash/,
  );
  await execute({ action: "stop", id: "bash_1" });
  assert.equal(stopped, "bash_1");
  assert.equal(tool.definition.classifyRisk?.({ action: "logs" }), "read");
  assert.equal(tool.definition.classifyRisk?.({ action: "stop" }), "command");
});
