import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createLogger,
  resolveLogLevel,
  type StructuredLogLevel,
} from "../src/domains/logs/structured-logger.js";

type Captured = { level: StructuredLogLevel; record: Record<string, any> };

function capture(level: StructuredLogLevel = "debug") {
  const lines: Captured[] = [];
  const logger = createLogger({
    level,
    base: { source: "test", component: "unit" },
    sink: (lvl, line) => lines.push({ level: lvl, record: JSON.parse(line) }),
  });
  return { logger, lines };
}

function recordAt(lines: Captured[], index: number): Record<string, any> {
  const entry = lines[index];
  assert.ok(entry, `expected a log record at index ${index}`);
  return entry.record;
}

function recordWithMessage(
  lines: Captured[],
  message: string,
): Record<string, any> {
  const entry = lines.find((line) => line.record.message === message);
  assert.ok(entry, `expected a log record with message "${message}"`);
  return entry.record;
}

describe("structured logger", () => {
  it("emits JSON with base bindings, level, message and timestamp", () => {
    const { logger, lines } = capture();
    logger.info("hello", { sandboxId: "sbx_1" });
    assert.equal(lines.length, 1);
    const record = recordAt(lines, 0);
    assert.equal(record.level, "info");
    assert.equal(record.message, "hello");
    assert.equal(record.source, "test");
    assert.equal(record.component, "unit");
    assert.equal(record.sandboxId, "sbx_1");
    assert.match(record.ts, /\d{4}-\d{2}-\d{2}T/);
  });

  it("gates output by level", () => {
    const { logger, lines } = capture("warn");
    logger.debug("nope");
    logger.info("nope");
    logger.warn("yep");
    logger.error("yep");
    assert.deepEqual(
      lines.map((entry) => entry.record.message),
      ["yep", "yep"],
    );
  });

  it("merges child bindings into every record", () => {
    const { logger, lines } = capture();
    const child = logger.child({ sandboxId: "sbx_1", sessionId: "sess_1" });
    child.info("work", { method: "sandbox.snapshot.get" });
    const record = recordAt(lines, 0);
    assert.equal(record.sandboxId, "sbx_1");
    assert.equal(record.sessionId, "sess_1");
    assert.equal(record.method, "sandbox.snapshot.get");
  });

  it("redacts secret-ish keys deeply", () => {
    const { logger, lines } = capture();
    logger.info("auth", {
      authorization: "Bearer abc",
      nested: { apiKey: "k", ok: 1 },
      list: [{ token: "t" }],
    });
    const record = recordAt(lines, 0);
    assert.equal(record.authorization, "[REDACTED]");
    assert.equal(record.nested.apiKey, "[REDACTED]");
    assert.equal(record.nested.ok, 1);
    assert.equal(record.list[0].token, "[REDACTED]");
  });

  it("serializes errors under the err key", () => {
    const { logger, lines } = capture();
    logger.error("boom", { err: new Error("kaboom") });
    const record = recordAt(lines, 0);
    assert.equal(record.err.message, "kaboom");
    assert.equal(record.err.name, "Error");
    assert.ok(typeof record.err.stack === "string");
  });

  it("withTiming logs completion with durationMs and rethrows failures", async () => {
    const { logger, lines } = capture();
    const value = await logger.withTiming("op", { method: "m" }, () => 42);
    assert.equal(value, 42);
    const completed = recordWithMessage(lines, "op completed");
    assert.equal(typeof completed.durationMs, "number");

    await assert.rejects(
      logger.withTiming("op2", {}, () => {
        throw new Error("fail");
      }),
    );
    const failed = recordWithMessage(lines, "op2 failed");
    assert.equal(failed.err.message, "fail");
  });

  it("tolerates circular structures without throwing", () => {
    const { logger, lines } = capture();
    const circular: Record<string, unknown> = { name: "x" };
    circular.self = circular;
    assert.doesNotThrow(() => logger.info("cyclic", { circular }));
    assert.equal(lines.length, 1);
    assert.match(JSON.stringify(recordAt(lines, 0)), /\[circular\]/);
  });

  it("resolveLogLevel coerces strings and falls back", () => {
    assert.equal(resolveLogLevel("DEBUG"), "debug");
    assert.equal(resolveLogLevel("warn"), "warn");
    assert.equal(resolveLogLevel("nonsense"), "info");
    assert.equal(resolveLogLevel(undefined, "error"), "error");
  });
});
