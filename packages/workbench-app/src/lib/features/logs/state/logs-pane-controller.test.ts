import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  ApplicationLogQuery,
  ApplicationLogQueryResponse,
  ApplicationLogRecord,
} from "@nervekit/contracts";
import {
  LogsPaneController,
  logsFilterRequest,
  serializeApplicationLogs,
  type LogsPaneDependencies,
} from "./logs-pane-controller";
import {
  formatApplicationLog,
  hasLogDetail,
  logContextEntries,
  logErrorEntries,
  logReferences,
  logSummaryAttributes,
} from "$lib/presentation/logs/log-entry";

function log(
  id: string,
  overrides: Partial<ApplicationLogRecord> = {},
): ApplicationLogRecord {
  return {
    seq: Number(id.replace(/\D/g, "")) || 1,
    id: `log_${id}`,
    ts: "2026-08-10T12:00:00.000Z",
    level: "info",
    source: "web",
    component: "workbench",
    message: id,
    ...overrides,
  };
}

function response(
  ...logs: ApplicationLogRecord[]
): ApplicationLogQueryResponse {
  return {
    logs,
    nextCursor: logs.at(-1)?.seq ?? 0,
    hasMoreBefore: false,
  };
}

function dependencies(
  overrides: Partial<LogsPaneDependencies> = {},
): LogsPaneDependencies {
  return {
    getLogs: async () => response(),
    pruneLogs: async () => ({ pruned: 0 }),
    writeText: async () => undefined,
    ...overrides,
  };
}

describe("logs pane controller", () => {
  it("normalizes filters for query and prune requests", () => {
    assert.deepEqual(
      logsFilterRequest({
        level: "warn",
        source: "all",
        component: " api ",
        contains: "  ",
      }),
      {
        level: "warn",
        source: undefined,
        component: "api",
        contains: undefined,
      },
    );
  });

  it("exposes newest rows first and serializes the visible order", async () => {
    let copied = "";
    const controller = new LogsPaneController(
      dependencies({
        getLogs: async () => response(log("1"), log("2")),
        writeText: async (text) => {
          copied = text;
        },
      }),
    );

    await controller.refresh();
    assert.deepEqual(
      controller.rows.map((entry) => entry.message),
      ["2", "1"],
    );
    await controller.copy();
    assert.equal(copied, serializeApplicationLogs(controller.rows));
  });

  it("refreshes after prune and reports singular and plural counts", async () => {
    let pruned = 1;
    let refreshes = 0;
    const controller = new LogsPaneController(
      dependencies({
        getLogs: async () => {
          refreshes += 1;
          return response();
        },
        pruneLogs: async () => ({ pruned }),
      }),
    );

    await controller.prune();
    assert.equal(controller.notice, "Pruned 1 log entry.");
    pruned = 2;
    await controller.prune();
    assert.equal(controller.notice, "Pruned 2 log entries.");
    assert.equal(refreshes, 2);
  });

  it("ignores a stale refresh response", async () => {
    let resolveFirst!: (value: ApplicationLogQueryResponse) => void;
    let resolveSecond!: (value: ApplicationLogQueryResponse) => void;
    let call = 0;
    const controller = new LogsPaneController(
      dependencies({
        getLogs: () =>
          new Promise((resolve) => {
            call += 1;
            if (call === 1) resolveFirst = resolve;
            else resolveSecond = resolve;
          }),
      }),
    );

    const first = controller.refresh();
    const second = controller.refresh();
    resolveSecond(response(log("2")));
    await second;
    resolveFirst(response(log("1")));
    await first;

    assert.deepEqual(
      controller.rows.map((entry) => entry.message),
      ["2"],
    );
    assert.equal(controller.loading, false);
  });

  it("loads and deduplicates older pages with an exclusive sequence cursor", async () => {
    const queries: ApplicationLogQuery[] = [];
    const controller = new LogsPaneController(
      dependencies({
        getLogs: async (query) => {
          queries.push(query);
          if (query.beforeSeq === undefined) {
            return { ...response(log("3"), log("4")), hasMoreBefore: true };
          }
          return response(log("1"), log("2"), log("3"));
        },
      }),
    );

    await controller.refresh();
    await controller.loadEarlier();

    assert.equal(queries[1]?.beforeSeq, 3);
    assert.deepEqual(
      controller.rows.map((entry) => entry.message),
      ["4", "3", "2", "1"],
    );
    assert.equal(controller.hasMoreBefore, false);
  });

  it("invalidates historical paging as soon as filters change", async () => {
    const controller = new LogsPaneController(
      dependencies({
        getLogs: async () => ({
          ...response(log("2")),
          hasMoreBefore: true,
        }),
      }),
    );

    await controller.refresh();
    controller.setContains("new filter");

    assert.equal(controller.hasMoreBefore, false);
    assert.equal(controller.loadingEarlier, false);
  });

  it("keeps visible rows when an older page fails and ignores it after refresh", async () => {
    let rejectPage!: (reason: Error) => void;
    let calls = 0;
    const controller = new LogsPaneController(
      dependencies({
        getLogs: async (query) => {
          calls += 1;
          if (calls === 1)
            return { ...response(log("2")), hasMoreBefore: true };
          if (query.beforeSeq !== undefined) {
            return new Promise((_, reject) => {
              rejectPage = reject;
            });
          }
          return response(log("5"));
        },
      }),
    );

    await controller.refresh();
    const older = controller.loadEarlier();
    await controller.refresh();
    rejectPage(new Error("old failure"));
    await older;

    assert.deepEqual(
      controller.rows.map((entry) => entry.message),
      ["5"],
    );
    assert.equal(controller.historyError, undefined);
    assert.equal(controller.loadingEarlier, false);
  });
});

describe("log entry helpers", () => {
  it("projects labeled references, context, and detail state", () => {
    const entry = log("3", {
      requestId: "request",
      toolCallId: "tool_test",
      context: { count: 2, displayLabel: "ok" },
    });

    assert.deepEqual(logReferences(entry), [
      { key: "requestId", label: "request", value: "request" },
      { key: "toolCallId", label: "tool call", value: "tool_test" },
    ]);
    assert.deepEqual(logContextEntries(entry), [
      { key: "count", label: "count", value: "2" },
      { key: "displayLabel", label: "display label", value: "ok" },
    ]);
    assert.equal(hasLogDetail(entry), true);
    assert.equal(hasLogDetail(log("4")), false);
  });

  it("prioritizes identifying scalar attributes and skips message duplicates", () => {
    const entry = log("5", {
      message: "Slow GitHub request: github-status",
      context: {
        status: 200,
        outcome: "slow",
        operation: "github-status",
        repository: "nervekit/nerve",
        ignoredObject: { count: 1 },
      },
    });

    assert.deepEqual(logSummaryAttributes(entry), [
      {
        key: "repository",
        label: "repository",
        value: "nervekit/nerve",
      },
      { key: "status", label: "status", value: "200" },
    ]);
  });

  it("safely bounds nested context and preserves complete error details", () => {
    const circular: Record<string, unknown> = { label: "root" };
    circular.self = circular;
    const entry = log("6", {
      context: { circular, long: "x".repeat(4_100) },
      error: {
        name: "TypeError",
        message: "kaput",
        cause: "upstream",
        stack: "TypeError: kaput\n at test",
      },
    });

    assert.match(logContextEntries(entry)[0]?.value ?? "", /\[Circular\]/);
    assert.equal(logContextEntries(entry)[1]?.value.endsWith("…"), true);
    assert.deepEqual(logErrorEntries(entry), [
      { key: "error", label: "error", value: "TypeError: kaput" },
      { key: "cause", label: "cause", value: "upstream" },
      {
        key: "stack",
        label: "stack",
        value: "TypeError: kaput\n at test",
      },
    ]);
  });

  it("serializes rich records in readable visible order", () => {
    const first = log("7", {
      requestId: "request_7",
      durationMs: 42,
      context: { method: "GET", status: 200 },
      error: { message: "problem" },
    });
    const second = log("8");

    assert.equal(
      serializeApplicationLogs([first, second]),
      `${formatApplicationLog(first)}\n\n${formatApplicationLog(second)}`,
    );
    assert.match(formatApplicationLog(first), / 42ms\n {2}request: request_7/);
    assert.match(formatApplicationLog(first), /\n {2}method: GET/);
    assert.match(formatApplicationLog(first), /\n {2}error: problem$/);
  });
});
