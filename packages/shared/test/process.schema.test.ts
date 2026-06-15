import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type ProcessRecord, processRecordSchema } from "../src/index.js";

function record(overrides: Partial<ProcessRecord> = {}): ProcessRecord {
  return {
    id: "proc_test",
    cwd: "/tmp/project",
    command: "pnpm dev",
    status: "running",
    readiness: { outcome: "pending" },
    stdoutPath: "/tmp/proc/stdout.log",
    stderrPath: "/tmp/proc/stderr.log",
    logsPath: "/tmp/proc/logs.jsonl",
    startedAt: "2026-01-02T03:04:05.000Z",
    updatedAt: "2026-01-02T03:04:05.000Z",
    ...overrides,
  };
}

describe("processRecordSchema runtime metadata", () => {
  it("accepts records with valid runtime metadata", () => {
    const parsed = processRecordSchema.safeParse(
      record({
        runtime: {
          platform: "linux",
          childPid: 1234,
          processGroupId: 1234,
          detached: true,
          shell: true,
          spawnedAt: "2026-01-02T03:04:06.000Z",
        },
      }),
    );

    assert.equal(parsed.success, true);
  });

  it("accepts older records without runtime metadata", () => {
    const parsed = processRecordSchema.safeParse(record());

    assert.equal(parsed.success, true);
  });

  it("rejects invalid runtime PID values", () => {
    const parsed = processRecordSchema.safeParse(
      record({
        runtime: {
          platform: "linux",
          childPid: -1,
          detached: true,
          shell: true,
          spawnedAt: "2026-01-02T03:04:06.000Z",
        },
      }),
    );

    assert.equal(parsed.success, false);
  });
});
