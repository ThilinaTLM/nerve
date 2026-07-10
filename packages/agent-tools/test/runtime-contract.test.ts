import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createTodoHandlers,
  createToolDispatcher,
  decideToolPermission,
  resolveToolAvailability,
  type TodoItem,
  ToolRuntimeError,
} from "../src/index.js";

describe("shared tool runtime contract", () => {
  it("dispatches local and host tools with preparation, output, and lifecycle", async () => {
    const events: string[] = [];
    const dispatcher = createToolDispatcher({
      advertisedToolNames: new Set(["edit", "todos_get"]),
      hostHandlers: {
        todos_get: async () => ({ content: "host" }),
      },
      localOverrides: {
        edit: async (args, context) => {
          context.onUpdate?.({
            kind: "output",
            stream: "combined",
            chunk: String(args.path),
          });
          return { content: String(args.path) };
        },
      },
      contextFor: async () => ({ cwd: process.cwd() }),
      authorize: (name, args) => ({
        decision: "allow",
        risk: name === "edit" ? "workspace_write" : "read",
        reason: "test",
        normalizedArgs: args,
      }),
      lifecycle: {
        requested: () => events.push("requested"),
        started: () => events.push("started"),
        output: () => events.push("output"),
        completed: () => events.push("completed"),
      },
    });
    const result = await dispatcher.execute("edit", { path: "x" });
    assert.equal(result.content, "x");
    assert.deepEqual(events, ["requested", "started", "output", "completed"]);
    assert.equal((await dispatcher.execute("todos_get", {})).content, "host");
  });

  it("rejects unavailable, denied, approval, and missing host handlers", async () => {
    assert.throws(
      () =>
        createToolDispatcher({
          advertisedToolNames: new Set(["ask_user"]),
          hostHandlers: {},
          contextFor: () => ({ cwd: process.cwd() }),
        }),
      (error) =>
        error instanceof ToolRuntimeError &&
        error.code === "MISSING_TOOL_HANDLER",
    );
    const denied = createToolDispatcher({
      advertisedToolNames: new Set(["read"]),
      hostHandlers: {},
      contextFor: () => ({ cwd: process.cwd() }),
      authorize: (_name, args) => ({
        decision: "deny",
        risk: "read",
        reason: "no",
        normalizedArgs: args,
      }),
    });
    await assert.rejects(
      denied.execute("read", { path: "x" }),
      (error) =>
        error instanceof ToolRuntimeError && error.code === "TOOL_DENIED",
    );
    await assert.rejects(
      denied.execute("write", { path: "x", content: "x" }),
      (error) =>
        error instanceof ToolRuntimeError && error.code === "TOOL_UNAVAILABLE",
    );
  });

  it("applies shared availability and permission semantics", () => {
    const readOnly = resolveToolAvailability({ permissionLevel: "read_only" });
    assert.ok(readOnly.activeToolNames.includes("read"));
    assert.ok(!readOnly.activeToolNames.includes("write"));
    assert.equal(
      decideToolPermission(
        "bash",
        { command: "rm -rf dist" },
        {
          permissionLevel: "supervised",
          approvalPolicy: { autoApproveReadOnly: true },
        },
      ).decision,
      "approval",
    );
    assert.equal(
      decideToolPermission(
        "write",
        {},
        {
          permissionLevel: "read_only",
          approvalPolicy: { autoApproveReadOnly: true },
        },
      ).decision,
      "deny",
    );
  });

  it("shares todo validation and result formatting through a host port", async () => {
    let state: TodoItem[] = [];
    const handlers = createTodoHandlers({
      get: async () => state,
      set: async (_scope, todos) => (state = todos),
    });
    const context = { cwd: process.cwd(), toolName: "todos_set" as const };
    const set = await handlers.todos_set?.(
      { todos: [{ todo: "Ship", done: false }] },
      context,
    );
    assert.match(set?.content ?? "", /0\/1 complete/);
    const get = await handlers.todos_get?.(
      {},
      { ...context, toolName: "todos_get" },
    );
    assert.deepEqual((get?.details as { todos: TodoItem[] }).todos, state);
  });
});
