import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  taskControlToolResultSchema,
  taskStartToolResultSchema,
  taskStatusToolResultSchema,
} from "../../src/domains/tools/index.js";
import {
  launchEnvInfoSchema,
  launchLogQueryResponseSchema,
  launchLogQuerySchema,
  launchRecordSchema,
  type LaunchRecord,
} from "../../src/domains/launches/index.js";

function record(overrides: Partial<LaunchRecord> = {}): LaunchRecord {
  return {
    id: "launch_test",
    cwd: "/tmp/project",
    command: "pnpm dev",
    status: "running",
    readiness: { outcome: "pending" },
    stdoutPath: "/tmp/launch/stdout.log",
    stderrPath: "/tmp/launch/stderr.log",
    logsPath: "/tmp/launch/logs.jsonl",
    startedAt: "2026-01-02T03:04:05.000Z",
    updatedAt: "2026-01-02T03:04:05.000Z",
    ...overrides,
  };
}

describe("launchRecordSchema env metadata", () => {
  it("strips raw env from public launch records", () => {
    const parsed = launchRecordSchema.parse({
      ...record(),
      env: { API_TOKEN: "secret", PORT: "3000" },
    });

    assert.equal("env" in parsed, false);
  });

  it("rejects non-redacted public env metadata", () => {
    const parsed = launchEnvInfoSchema.safeParse({
      keys: ["PORT"],
      persisted: true,
      redacted: false,
    });

    assert.equal(parsed.success, false);
  });
});

describe("tool task result metadata", () => {
  it("rejects missing required task-tool payload fields", () => {
    assert.equal(taskStartToolResultSchema.safeParse({}).success, false);
    assert.equal(
      taskStartToolResultSchema.safeParse({
        task: record(),
        otherActiveTasks: [],
        otherActiveTaskCount: 0,
      }).success,
      true,
    );
    assert.equal(taskStatusToolResultSchema.safeParse({}).success, false);
    assert.equal(
      taskControlToolResultSchema.safeParse({
        action: "stop",
        task: record({ status: "cancelled" }),
      }).success,
      false,
    );
    assert.equal(
      taskControlToolResultSchema.safeParse({
        action: "restart",
        task: record(),
      }).success,
      false,
    );
  });
});

describe("launch log paging metadata", () => {
  it("accepts backward cursors and requires pagination flags", () => {
    assert.equal(
      launchLogQuerySchema.safeParse({
        mode: "recent",
        beforeSeq: 42,
        limit: 20,
      }).success,
      true,
    );
    assert.equal(
      launchLogQueryResponseSchema.safeParse({
        launch: record(),
        events: [],
        nextCursor: 42,
        hasMoreBefore: true,
        hasMoreAfter: false,
        mode: "recent",
      }).success,
      true,
    );
    assert.equal(
      launchLogQueryResponseSchema.safeParse({
        launch: record(),
        events: [],
        nextCursor: 42,
        mode: "recent",
      }).success,
      false,
    );
  });
});

describe("launchRecordSchema runtime metadata", () => {
  const runtime = {
    version: 2 as const,
    platform: "linux",
    childPid: 1234,
    processGroupId: 1234,
    detached: true,
    shell: true,
    containment: "process-group" as const,
    spawnedAt: "2026-01-02T03:04:06.000Z",
    identity: { kind: "linux" as const, startTimeTicks: 5678 },
    capabilities: {
      identity: true,
      processTree: true,
      listeningPorts: true,
      detail: "native:process-group",
    },
  };

  it("accepts complete native runtime metadata", () => {
    assert.equal(
      launchRecordSchema.safeParse(record({ runtime })).success,
      true,
    );
  });

  it("rejects incomplete and legacy runtime metadata", () => {
    assert.equal(
      launchRecordSchema.safeParse(
        record({ runtime: { ...runtime, childPid: -1 } }),
      ).success,
      false,
    );
    for (const legacy of [
      { ...runtime, version: undefined },
      { ...runtime, containment: undefined },
      { ...runtime, identity: undefined },
      { ...runtime, identity: { kind: "legacy_unverified" } },
    ]) {
      assert.equal(
        launchRecordSchema.safeParse({ ...record(), runtime: legacy }).success,
        false,
      );
    }
  });
});
