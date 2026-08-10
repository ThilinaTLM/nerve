import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
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
  hasLogDetail,
  logContextEntries,
  logReferences,
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
  return { logs, nextCursor: logs.at(-1)?.seq ?? 0 };
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
});

describe("log entry helpers", () => {
  it("projects references, context, and detail state", () => {
    const entry = log("3", {
      requestId: "request",
      context: { count: 2, label: "ok" },
    });

    assert.deepEqual(logReferences(entry), ["request"]);
    assert.deepEqual(logContextEntries(entry), [
      ["count", "2"],
      ["label", "ok"],
    ]);
    assert.equal(hasLogDetail(entry), true);
    assert.equal(hasLogDetail(log("4")), false);
  });
});
