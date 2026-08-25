import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createExploreHandlers,
  createInteractionHandlers,
  createPlanHandlers,
  createTaskHandlers,
  createTodoHandlers,
  createToolDispatcher,
  evaluateRuntimeToolPermission,
  resolveToolAvailability,
  type TodoItem,
  ToolRuntimeError,
} from "../src/index.js";

describe("shared tool runtime contract", () => {
  it("dispatches local and host tools with preparation, output, and lifecycle", async () => {
    const events: string[] = [];
    const observedPaths: string[] = [];
    const dispatcher = createToolDispatcher({
      advertisedToolNames: new Set(["edit", "todos_get"]),
      hostHandlers: {
        todos_get: async () => ({ content: "host" }),
      },
      localOverrides: {
        edit: async (args, context) => {
          observedPaths.push(`execute:${String(args.path)}`);
          context.onUpdate?.({
            kind: "output",
            stream: "combined",
            chunk: String(args.path),
          });
          return { content: String(args.path) };
        },
      },
      contextFor: async (_name, args) => {
        observedPaths.push(`context:${String(args.path)}`);
        return { cwd: process.cwd() };
      },
      authorize: (name, args) => ({
        decision: "allow",
        risk: name === "edit" ? "workspace_write" : "read",
        reason: "test",
        normalizedArgs:
          name === "edit" ? { ...args, path: "authorized/x" } : args,
      }),
      lifecycle: {
        requested: (_name, args) => {
          events.push("requested");
          observedPaths.push(`requested:${String(args.path)}`);
        },
        started: (_name, args) => {
          events.push("started");
          observedPaths.push(`started:${String(args.path)}`);
        },
        output: () => events.push("output"),
        completed: () => events.push("completed"),
      },
    });
    const result = await dispatcher.execute("edit", { path: "x" });
    assert.equal(result.content, "authorized/x");
    assert.deepEqual(events, ["requested", "started", "output", "completed"]);
    assert.deepEqual(observedPaths, [
      "requested:authorized/x",
      "context:authorized/x",
      "started:authorized/x",
      "execute:authorized/x",
    ]);
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
      evaluateRuntimeToolPermission(
        "bash",
        { command: "rm -rf dist" },
        {
          permissionLevel: "supervised",
        },
      ).decision,
      "approval",
    );
    assert.equal(
      evaluateRuntimeToolPermission(
        "write",
        {},
        {
          permissionLevel: "read_only",
        },
      ).decision,
      "deny",
    );
  });

  it("applies explicit tool-group approval requirements after baseline policy", () => {
    assert.equal(
      evaluateRuntimeToolPermission(
        "write",
        { path: "x", content: "x" },
        { permissionLevel: "autonomous", groupRequireApproval: "always" },
      ).decision,
      "approval",
    );
    assert.equal(
      evaluateRuntimeToolPermission(
        "write",
        { path: "x", content: "x" },
        { permissionLevel: "read_only", groupRequireApproval: "always" },
      ).decision,
      "deny",
    );
  });

  it("routes orchestration handlers through typed ports with opaque identity", async () => {
    const identity = { opaque: "host-suspension-id" };
    const calls: string[] = [];
    const context = {
      cwd: process.cwd(),
      toolName: "ask_user" as const,
      identity,
      signal: new AbortController().signal,
    };
    const interaction = createInteractionHandlers({
      resolve: async (value) => {
        assert.equal(value, identity);
        calls.push("interaction.resolve");
        return undefined;
      },
      request: async (value, request) => {
        assert.equal(value, identity);
        assert.equal(request.question, "Choose one");
        calls.push("interaction.request");
        return { content: "suspended" };
      },
    });
    assert.equal(
      (await interaction.ask_user?.({ question: " Choose one " }, context))
        ?.content,
      "suspended",
    );

    const plans = createPlanHandlers({
      enter: async (value, reason) => {
        assert.equal(value, identity);
        calls.push(`plan.enter:${reason}`);
        return { content: "planning" };
      },
      present: async (value, request) => {
        assert.equal(value, identity);
        calls.push(`plan.present:${request.filePath}`);
        return { content: "review" };
      },
      forceExit: async () => ({ content: "coding" }),
    });
    await plans.plan_mode_enter?.(
      { reason: " investigate " },
      { ...context, toolName: "plan_mode_enter" },
    );
    await plans.plan_mode_present?.(
      { file_path: " plans/reuse.md " },
      { ...context, toolName: "plan_mode_present" },
    );

    const tasks = createTaskHandlers({
      start: async (_args, value, signal) => {
        assert.equal(value, identity);
        assert.equal(signal, context.signal);
        calls.push("task.start");
        return { content: "started" };
      },
      status: async () => ({ content: "status" }),
      logs: async () => ({ content: "logs" }),
      control: async () => ({ content: "controlled" }),
    });
    await tasks.task_start?.(
      { command: "pnpm check" },
      { ...context, toolName: "task_start" },
    );
    await assert.rejects(
      tasks.task_start?.(
        { tasks: [{ command: "pnpm check" }] },
        { ...context, toolName: "task_start" },
      ) ?? Promise.resolve(),
      /command|tasks\[\]/,
    );
    await assert.rejects(
      tasks.task_logs?.({}, { ...context, toolName: "task_logs" }) ??
        Promise.resolve(),
      /taskId/,
    );
    await tasks.task_control?.(
      { taskId: "task_one", action: "stop" },
      { ...context, toolName: "task_control" },
    );
    await assert.rejects(
      tasks.task_control?.(
        { action: "stop" },
        { ...context, toolName: "task_control" },
      ) ?? Promise.resolve(),
      /taskId/,
    );
    await assert.rejects(
      tasks.task_control?.(
        { taskId: "task_one", action: "restart", reason: "replace" },
        { ...context, toolName: "task_control" },
      ) ?? Promise.resolve(),
      /stop-only/,
    );

    const explore = createExploreHandlers({
      run: async (request, value, signal) => {
        assert.equal(value, identity);
        assert.equal(signal, context.signal);
        calls.push(`explore:${request.tasks[0]?.task}`);
        return { content: "report" };
      },
    });
    await explore.explore?.(
      {
        tasks: [{ task: " inspect adapters " }],
        context:
          "Parent inspected the orchestration adapters and needs focused follow-up evidence.",
      },
      { ...context, toolName: "explore" },
    );
    assert.throws(
      () =>
        explore.explore?.(
          {
            task: "The old top-level task request is no longer supported.",
            context:
              "Parent inspected the orchestration adapters and needs focused follow-up evidence.",
          },
          { ...context, toolName: "explore" },
        ),
      /tasks array/,
    );

    assert.deepEqual(calls, [
      "interaction.resolve",
      "interaction.request",
      "plan.enter:investigate",
      "plan.present:plans/reuse.md",
      "task.start",
      "explore:inspect adapters",
    ]);
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
