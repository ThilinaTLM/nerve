import assert from "node:assert/strict";
import { test } from "node:test";
import { createCompletionContextReader } from "../../../src/domains/completions/completion-context-reader.js";

void test("server context is bounded, project-relative and conversation scoped; shell history is never parsed", () => {
  let reads = 0;
  let sequence = 1;
  let allowHistory = true;
  const context = createCompletionContextReader({
    metadata: () => ({
      projectId: "p",
      lastSequence: sequence,
      get toolCalls() {
        throw new Error("Must not materialize tool calls");
      },
      get queue() {
        throw new Error("Must not materialize queue");
      },
      get asyncBash() {
        throw new Error("Must not materialize background commands");
      },
      get children() {
        throw new Error("Must not materialize children");
      },
    }),
    getSnapshot() {
      throw new Error("Full snapshots are forbidden on completion keystrokes");
    },
    project: () => ({ directory: "/synthetic/project" }),
    history: (_id: string, page: { limit: number }) => {
      assert.equal(page.limit, 64);
      assert.equal(
        allowHistory,
        true,
        "history remains deferred on cache hits",
      );
      reads++;
      return [
        {
          conversationId: "c",
          type: "user_message",
          payload: {
            text: "Review @file:src/session.ts and @src/config.ts; not @skill:review or @../secret",
          },
        },
        {
          conversationId: "c",
          type: "tool_call_response",
          payload: {
            toolName: "edit",
            outcome: "completed",
            arguments: { path: "/synthetic/project/src/edited.ts" },
          },
        },
        {
          conversationId: "c",
          type: "tool_call_response",
          payload: {
            toolName: "edit",
            outcome: "failed",
            arguments: { path: "failed.ts" },
          },
        },
        {
          conversationId: "c",
          type: "tool_call_response",
          payload: {
            toolName: "read",
            outcome: "completed",
            arguments: { path: "/outside/secret" },
          },
        },
        {
          conversationId: "c",
          type: "tool_call_response",
          payload: {
            toolName: "bash",
            outcome: "completed",
            arguments: { command: "cat command-history.ts" },
          },
        },
        {
          conversationId: "foreign",
          type: "user_message",
          payload: { text: "@foreign.ts" },
        },
      ];
    },
  } as never);
  const result = context({ projectId: "p", conversationId: "c" });
  assert.deepEqual(result.referencedPaths, ["src/session.ts", "src/config.ts"]);
  assert.deepEqual(result.editedPaths, ["src/edited.ts"]);
  allowHistory = false;
  assert.equal(context({ projectId: "p", conversationId: "c" }), result);
  assert.equal(reads, 1);
  sequence++;
  allowHistory = true;
  context({ projectId: "p", conversationId: "c" });
  assert.equal(reads, 2);
  assert.throws(
    () => context({ projectId: "foreign", conversationId: "c" }),
    /another project/,
  );
  assert.deepEqual(context({ projectId: "p" }), {});
});
