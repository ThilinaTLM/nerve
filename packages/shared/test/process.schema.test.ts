import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type ProcessRecord,
  processEnvInfoSchema,
  processLaunchConfigSchema,
  processRecordSchema,
  startProcessRequestSchema,
} from "../src/index.js";

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

describe("processRecordSchema env metadata", () => {
  it("accepts redacted env metadata", () => {
    const parsed = processRecordSchema.safeParse(
      record({
        envInfo: {
          keys: ["NODE_ENV", "PORT"],
          persisted: true,
          redacted: true,
        },
      }),
    );

    assert.equal(parsed.success, true);
    if (parsed.success) {
      assert.deepEqual(parsed.data.envInfo?.keys, ["NODE_ENV", "PORT"]);
    }
  });

  it("strips raw env from public process records", () => {
    const parsed = processRecordSchema.parse({
      ...record(),
      env: { API_TOKEN: "secret", PORT: "3000" },
    });

    assert.equal("env" in parsed, false);
  });

  it("keeps start requests compatible with raw env input", () => {
    const parsed = startProcessRequestSchema.parse({
      cwd: "/tmp/project",
      command: "pnpm dev",
      env: { PORT: "3000" },
    });

    assert.deepEqual(parsed.env, { PORT: "3000" });
  });

  it("accepts raw env in encrypted launch config storage schema", () => {
    const parsed = processLaunchConfigSchema.parse({
      version: 1,
      env: { API_TOKEN: "secret", PORT: "3000" },
      createdAt: "2026-01-02T03:04:05.000Z",
      updatedAt: "2026-01-02T03:04:05.000Z",
    });

    assert.deepEqual(parsed.env, { API_TOKEN: "secret", PORT: "3000" });
  });

  it("rejects non-redacted public env metadata", () => {
    const parsed = processEnvInfoSchema.safeParse({
      keys: ["PORT"],
      persisted: true,
      redacted: false,
    });

    assert.equal(parsed.success, false);
  });
});

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
