import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import {
  createId,
  type TaskLogEvent,
  type TaskRecord,
} from "@nervekit/contracts";
import {
  createTaskLogCursor,
  MAX_BUFFERED_LOG_LINE_CHARS,
  TaskLogService,
} from "../src/domains/tasks/task-log.service.js";
import { EventBus } from "../src/infrastructure/events/index.js";

const roots: string[] = [];

after(async () => {
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("task log service line buffering", () => {
  it("buffers incomplete stdout line across chunks", async () => {
    const { record, service, cursor, onLog } = await createFixture();

    await service.captureOutput(record, cursor, "stdout", "hello ", onLog);
    assert.deepEqual(await service.readLogEvents(record.logsPath), []);

    await service.captureOutput(record, cursor, "stdout", "world\n", onLog);

    const events = await service.readLogEvents(record.logsPath);
    assert.deepEqual(
      events.map((event) => event.line),
      ["hello world"],
    );
    assert.equal(await readFile(record.stdoutPath, "utf8"), "hello world\n");
  });

  it("keeps stdout and stderr buffers separate", async () => {
    const { record, service, cursor, onLog, emitted } = await createFixture();

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
  });

  it("handles multiple complete lines plus trailing partial", async () => {
    const { record, service, cursor, onLog, emitted } = await createFixture();

    await service.captureOutput(record, cursor, "stdout", "a\nb\nc", onLog);
    assert.deepEqual(
      emitted.map((event) => event.line),
      ["a", "b"],
    );
    assert.equal(cursor.lineBuffers.stdout, "c");

    await service.captureOutput(record, cursor, "stdout", "d\n", onLog);
    assert.deepEqual(
      emitted.map((event) => event.line),
      ["a", "b", "cd"],
    );
    assert.equal(cursor.lineBuffers.stdout, "");
  });

  it("handles CRLF split across chunks", async () => {
    const { record, service, cursor, onLog, emitted } = await createFixture();

    await service.captureOutput(record, cursor, "stdout", "ready\r", onLog);
    await service.captureOutput(record, cursor, "stdout", "\n", onLog);

    assert.deepEqual(
      emitted.map((event) => event.line),
      ["ready"],
    );
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

  it("filters empty and whitespace-only buffered lines", async () => {
    const { record, service, cursor, onLog } = await createFixture();

    await service.captureOutput(record, cursor, "stdout", "   \n", onLog);
    await service.captureOutput(record, cursor, "stderr", "   ", onLog);
    await service.flushOutputBuffers(record, cursor, onLog);

    assert.deepEqual(await service.readLogEvents(record.logsPath), []);
  });

  it("increments log sequence only for emitted lines", async () => {
    const { record, service, onLog } = await createFixture();
    const cursor = createTaskLogCursor(5);

    await service.captureOutput(record, cursor, "stdout", "part", onLog);
    await service.captureOutput(
      record,
      cursor,
      "stdout",
      "ial\n   \nreal\n",
      onLog,
    );
    await service.captureOutput(record, cursor, "stdout", "   ", onLog);
    await service.flushOutputBuffers(record, cursor, onLog);

    const events = await service.readLogEvents(record.logsPath);
    assert.deepEqual(
      events.map((event) => [event.seq, event.line]),
      [
        [6, "partial"],
        [7, "real"],
      ],
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
  const service = new TaskLogService(new EventBus(root));
  return {
    record,
    service,
    cursor: createTaskLogCursor(),
    emitted,
    onLog: async (event) => {
      emitted.push(event);
    },
  };
}
