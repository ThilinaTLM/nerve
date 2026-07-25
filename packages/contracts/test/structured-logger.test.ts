import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createLogger,
  type StructuredLogLevel,
} from "../src/domains/logs/structured-logger.js";

type Captured = { level: StructuredLogLevel; record: Record<string, unknown> };

function capture(level: StructuredLogLevel = "debug") {
  const lines: Captured[] = [];
  const logger = createLogger({
    level,
    base: { source: "test", component: "unit" },
    sink: (lvl, line) => lines.push({ level: lvl, record: JSON.parse(line) }),
  });
  return { logger, lines };
}

function recordAt(lines: Captured[], index: number): Record<string, unknown> {
  const entry = lines[index];
  assert.ok(entry, `expected a log record at index ${index}`);
  return entry.record;
}

function recordWithMessage(
  lines: Captured[],
  message: string,
): Record<string, unknown> {
  const entry = lines.find((line) => line.record.message === message);
  assert.ok(entry, `expected a log record with message "${message}"`);
  return entry.record;
}

describe("structured logger", () => {
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

  it("a throwing onRecord tap does not prevent the sink from running", () => {
    const lines: string[] = [];
    const logger = createLogger({
      level: "debug",
      sink: (_level, line) => lines.push(line),
      onRecord: () => {
        throw new Error("tap boom");
      },
    });
    assert.doesNotThrow(() => logger.info("still logged"));
    assert.equal(lines.length, 1);
    assert.match(lines[0] ?? "", /still logged/);
  });
});
