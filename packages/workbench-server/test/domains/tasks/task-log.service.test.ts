import { createId } from "@nervekit/contracts";
import { type TaskLogEvent, type TaskRecord } from "@nervekit/contracts/tasks";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import {
  createTaskLogCursor,
  MAX_BUFFERED_LOG_LINE_CHARS,
  TaskLogService,
} from "../../../src/domains/tasks/application/task-log.service.js";
import { StreamLogRegistry } from "../../../src/infrastructure/events/index.js";
import { PerformanceMetricsCollector } from "../../../src/infrastructure/diagnostics/performance-metrics.js";

const roots: string[] = [];

after(async () => {
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("task log service line buffering", () => {
  it("keeps stdout and stderr buffers separate", async () => {
    const { record, service, cursor, onLog, emitted, metrics } =
      await createFixture();

    await service.captureOutput(record, cursor, "stdout", "out-", onLog);
    await service.captureOutput(record, cursor, "stderr", "err-", onLog);
    await service.captureOutput(record, cursor, "stdout", "line\n", onLog);
    await service.captureOutput(record, cursor, "stderr", "line\n", onLog);

    assert.deepEqual(
      emitted.map((event) => [event.stream, event.line]),
      [
        ["stdout", "out-line"],
        ["stderr", "err-line"],
      ],
    );
    const snapshot = metrics.snapshotAndReset();
    assert.equal(snapshot.metrics["task.outputChunk"]?.count, 4);
    assert.equal(snapshot.metrics["task.outputBytes"]?.count, 18);
    assert.equal(snapshot.metrics["task.outputLine"]?.count, 2);
    assert.equal(snapshot.metrics["task.outputCapture"]?.count, 4);
  });

  it("flush emits final non-newline fragment once", async () => {
    const { record, service, cursor, onLog } = await createFixture();

    await service.captureOutput(
      record,
      cursor,
      "stdout",
      "last line without newline",
      onLog,
    );
    assert.deepEqual(await service.readLogEvents(record.logsPath), []);

    await service.flushOutputBuffers(record, cursor, onLog);
    await service.flushOutputBuffers(record, cursor, onLog);

    const events = await service.readLogEvents(record.logsPath);
    assert.deepEqual(
      events.map((event) => event.line),
      ["last line without newline"],
    );
  });

  it("classifies log severity conservatively", async () => {
    const { record, service, cursor, onLog } = await createFixture();

    await service.captureOutput(
      record,
      cursor,
      "stdout",
      `${[
        "qa-fail:before-error",
        "client-serialized error details",
        "ERROR: synthetic failure",
        "fatal failure",
        "warning: heads up",
      ].join("\n")}\n`,
      onLog,
    );
    await service.captureOutput(
      record,
      cursor,
      "stderr",
      "warning: stderr warning\nplain stderr\n",
      onLog,
    );

    const events = await service.readLogEvents(record.logsPath);
    assert.deepEqual(
      events.map((event) => [event.stream, event.level, event.line]),
      [
        ["stdout", "info", "qa-fail:before-error"],
        ["stdout", "info", "client-serialized error details"],
        ["stdout", "error", "ERROR: synthetic failure"],
        ["stdout", "error", "fatal failure"],
        ["stdout", "warn", "warning: heads up"],
        ["stderr", "warn", "warning: stderr warning"],
        ["stderr", "error", "plain stderr"],
      ],
    );

    const errors = await service.queryLogs(record, { mode: "errors" });
    assert.deepEqual(
      errors.events.map((event) => event.line),
      ["ERROR: synthetic failure", "fatal failure", "plain stderr"],
    );
  });

  it("pages recent history backward without overlaps", async () => {
    const { record, service, cursor, onLog } = await createFixture();
    await service.captureOutput(
      record,
      cursor,
      "stdout",
      "one\ntwo\nthree\nfour\nfive\nsix\n",
      onLog,
    );

    const recent = await service.queryLogs(record, {
      mode: "recent",
      limit: 2,
    });
    assert.deepEqual(
      recent.events.map((event) => event.seq),
      [5, 6],
    );
    assert.equal(recent.hasMoreBefore, true);
    assert.equal(recent.hasMoreAfter, false);

    const older = await service.queryLogs(record, {
      mode: "recent",
      beforeSeq: recent.events[0]?.seq,
      limit: 2,
    });
    assert.deepEqual(
      older.events.map((event) => event.seq),
      [3, 4],
    );
    assert.equal(older.hasMoreBefore, true);
  });

  it("indexes exact raw UTF-8 byte ranges after durable stream capture", async () => {
    const { record, service, cursor, onLog } = await createFixture();
    const raw = Buffer.from("α\r\nβ🙂\n", "utf8");

    await service.captureOutput(
      record,
      cursor,
      "stdout",
      raw.subarray(0, 7),
      onLog,
    );
    await service.captureOutput(
      record,
      cursor,
      "stdout",
      raw.subarray(7),
      onLog,
    );

    const events = await service.readLogEvents(record.logsPath);
    assert.deepEqual(
      events.map((event) => event.raw),
      [
        { start: 0, end: 4, terminatorBytes: 2, fidelity: "captured" },
        { start: 4, end: 11, terminatorBytes: 1, fidelity: "captured" },
      ],
    );
    assert.deepEqual(await readFile(record.stdoutPath), raw);
  });

  it("caps large newline-less buffers", async () => {
    const { record, service, cursor, onLog } = await createFixture();
    const text = "x".repeat(MAX_BUFFERED_LOG_LINE_CHARS + 1);

    await service.captureOutput(record, cursor, "stdout", text, onLog);

    const events = await service.readLogEvents(record.logsPath);
    assert.equal(events.length, 1);
    assert.equal(events[0]?.line.length, text.length);
    assert.equal(cursor.lineBuffers.stdout, "");
  });
});

async function createFixture(): Promise<{
  record: TaskRecord;
  service: TaskLogService;
  cursor: ReturnType<typeof createTaskLogCursor>;
  emitted: TaskLogEvent[];
  onLog: (event: TaskLogEvent) => Promise<void>;
  metrics: PerformanceMetricsCollector;
}> {
  const root = await mkdtemp(join(tmpdir(), "nerve-task-log-"));
  roots.push(root);
  const id = createId("task");
  const dir = join(root, "task", id);
  await mkdir(dir, { recursive: true });
  const now = new Date().toISOString();
  const record: TaskRecord = {
    id,
    cwd: root,
    command: "fake command",
    status: "running",
    readiness: { outcome: "none" },
    stdoutPath: join(dir, "stdout.log"),
    stderrPath: join(dir, "stderr.log"),
    logsPath: join(dir, "logs.jsonl"),
    startedAt: now,
    updatedAt: now,
  };
  const emitted: TaskLogEvent[] = [];
  const metrics = new PerformanceMetricsCollector();
  const service = new TaskLogService(new StreamLogRegistry(root), {
    diagnostics: metrics,
  });
  return {
    record,
    service,
    cursor: createTaskLogCursor(),
    emitted,
    metrics,
    onLog: async (event) => {
      emitted.push(event);
    },
  };
}
