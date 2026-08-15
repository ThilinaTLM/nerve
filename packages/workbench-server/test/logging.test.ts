import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import {
  ApplicationLogger,
  serializeError,
} from "../src/infrastructure/diagnostics/index.js";

const roots: string[] = [];

after(async () => {
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function tempHome(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "nerve-logging-"));
  roots.push(root);
  return root;
}

describe("ApplicationLogger", () => {
  it("does no application-log work when disabled", async () => {
    const home = await tempHome();
    const logger = new ApplicationLogger({
      dataDir: home,
      component: "test",
      enabled: false,
      mirrorToConsole: false,
    });
    const child = logger.child({ component: "child" });

    await logger.hydrate();
    await logger.pruneRetention();
    await logger.info("ignored");
    await child.error("also ignored", { error: new Error("ignored") });
    const result = await logger.withTiming("info", "operation", async () => 42);
    await logger.removeLogsForConversations(["conv_test"]);
    await logger.flush();

    assert.equal(result, 42);
    assert.deepEqual(await logger.query(), { logs: [], nextCursor: 0 });
    assert.deepEqual(await logger.prune(), { pruned: 0, remaining: 0 });
    await assert.rejects(access(join(home, "logs")));
  });

  it("applies retention to dated daemon and desktop logs", async () => {
    const home = await tempHome();
    const logs = join(home, "logs");
    await mkdir(logs, { recursive: true });
    const oldApplication = join(logs, "application-2000-01-01.jsonl");
    const oldDesktop = join(logs, "desktop-2000-01-01.jsonl");
    const recentDesktop = join(logs, "desktop-2999-01-01.jsonl");
    await Promise.all([
      writeFile(oldApplication, ""),
      writeFile(oldDesktop, ""),
      writeFile(recentDesktop, ""),
    ]);
    const logger = new ApplicationLogger({
      dataDir: home,
      component: "test",
      retentionDays: 14,
      mirrorToConsole: false,
    });

    await logger.pruneRetention();

    await assert.rejects(access(oldApplication), /ENOENT/);
    await assert.rejects(access(oldDesktop), /ENOENT/);
    await access(recentDesktop);
  });

  it("writes, queries, and redacts structured application logs", async () => {
    const home = await tempHome();
    const logger = new ApplicationLogger({
      dataDir: home,
      component: "test",
      level: "debug",
      mirrorToConsole: false,
    });
    await logger.hydrate();

    await logger.info("hello", {
      requestId: "req_1",
      context: { ok: true, token: "secret", nested: { apiKey: "hidden" } },
    });
    await logger.error("boom", { error: new Error("kaput") });

    const response = await logger.query({ limit: 10 });
    assert.equal(response.logs.length, 2);
    assert.equal(response.logs[0].context?.token, "[Redacted]");
    assert.deepEqual(response.logs[0].context?.nested, {
      apiKey: "[Redacted]",
    });
    assert.equal(response.logs[1].error?.message, "kaput");
  });

  it("preserves client-serialized error details", () => {
    assert.deepEqual(
      serializeError({
        name: "TypeError",
        message: "fetch failed",
        stack: "at fetch",
      }),
      {
        name: "TypeError",
        message: "fetch failed",
        stack: "at fetch",
        cause: undefined,
      },
    );
  });

  it("stringifies non-error objects", () => {
    assert.deepEqual(serializeError({ reason: "bad" }), {
      message: '{"reason":"bad"}',
    });
  });

  it("filters by level and cursor", async () => {
    const home = await tempHome();
    const logger = new ApplicationLogger({
      dataDir: home,
      component: "test",
      level: "debug",
      mirrorToConsole: false,
    });
    await logger.hydrate();
    await logger.debug("debug message");
    await logger.warn("warn message");

    const warn = await logger.query({ level: "warn" });
    assert.equal(warn.logs.length, 1);
    assert.equal(warn.logs[0].message, "warn message");

    const since = await logger.query({ sinceSeq: warn.logs[0].seq });
    assert.equal(since.logs.length, 0);
  });

  it("prunes all application logs", async () => {
    const home = await tempHome();
    const logger = new ApplicationLogger({
      dataDir: home,
      component: "test",
      level: "debug",
      mirrorToConsole: false,
    });
    await logger.hydrate();
    await logger.info("first");
    await logger.error("second");

    const response = await logger.prune();
    assert.deepEqual(response, { pruned: 2, remaining: 0 });
    assert.equal((await logger.query({ limit: 10 })).logs.length, 0);

    await logger.warn("after prune");
    const after = await logger.query({ limit: 10 });
    assert.equal(after.logs.length, 1);
    assert.ok(after.logs[0].seq > 2);
  });

  it("prunes filtered application logs and preserves non-matches", async () => {
    const home = await tempHome();
    const logger = new ApplicationLogger({
      dataDir: home,
      component: "test",
      level: "debug",
      mirrorToConsole: false,
    });
    await logger.hydrate();
    await logger.info("keep me", { context: { tag: "alpha" } });
    await logger.warn("drop me", { context: { tag: "beta" } });
    await logger.warn("keep warning", { context: { tag: "alpha" } });

    const response = await logger.prune({ level: "warn", contains: "beta" });
    assert.deepEqual(response, { pruned: 1, remaining: 2 });

    const remaining = await logger.query({ limit: 10 });
    assert.deepEqual(
      remaining.logs.map((log) => log.message),
      ["keep me", "keep warning"],
    );
  });

  it("hydrates only the recent bounded tail and preserves sequence monotonicity", async () => {
    const home = await tempHome();
    const logsDir = join(home, "logs");
    await mkdir(logsDir, { recursive: true });
    const record = (seq: number, ts: string) => ({
      seq,
      id: `log_${seq}`,
      ts,
      level: "info",
      source: "orchestrator",
      component: "test",
      message: `message ${seq}`,
    });
    await writeFile(
      join(logsDir, "application-2026-01-01.jsonl"),
      `${JSON.stringify(record(1, "2026-01-01T00:00:00.000Z"))}\n`,
    );
    await writeFile(
      join(logsDir, "application-2026-01-02.jsonl"),
      [
        record(2, "2026-01-02T00:00:00.000Z"),
        record(3, "2026-01-02T00:00:01.000Z"),
        record(4, "2026-01-02T00:00:02.000Z"),
      ]
        .map((value) => JSON.stringify(value))
        .join("\n") + "\n",
    );
    const logger = new ApplicationLogger({
      dataDir: home,
      component: "test",
      maxBufferedLogs: 2,
      mirrorToConsole: false,
    });

    await logger.hydrate();
    await logger.info("after restart");

    const response = await logger.query({ limit: 10 });
    assert.equal(response.logs.at(-1)?.seq, 5);
    assert.equal(response.logs.at(-1)?.message, "after restart");
  });

  it("serializes concurrent appends in submission order", async () => {
    const home = await tempHome();
    const logger = new ApplicationLogger({
      dataDir: home,
      component: "test",
      level: "debug",
      mirrorToConsole: false,
    });
    await logger.hydrate();
    const child = logger.child({ component: "child" });
    await Promise.all([
      logger.info("first"),
      child.info("second"),
      logger.info("third"),
      child.info("fourth"),
    ]);
    const response = await logger.query({ limit: 10 });
    assert.deepEqual(
      response.logs.map((log) => log.message),
      ["first", "second", "third", "fourth"],
    );
    assert.deepEqual(
      response.logs.map((log) => log.seq),
      [1, 2, 3, 4],
    );
  });

  it("keeps individual write errors with their callers and continues after a rejected append", async () => {
    const home = await tempHome();
    const logger = new ApplicationLogger({
      dataDir: home,
      component: "test",
      level: "debug",
      mirrorToConsole: false,
    });
    await logger.hydrate();
    await logger.info("before failure");
    // Simulate a rejected append by pointing one logger at an invalid data
    // dir (a file cannot contain a logs/ directory).
    await logger.flush();
    const broken = new ApplicationLogger({
      dataDir: join(
        home,
        "logs",
        `application-${new Date().toISOString().slice(0, 10)}.jsonl`,
      ),
      component: "broken",
      level: "debug",
      mirrorToConsole: false,
    });
    await assert.rejects(broken.info("will fail"));
    // The same (broken) logger continues accepting later flushes.
    await broken.flush();
    // The healthy logger is unaffected and stays ordered.
    await logger.info("after failure");
    await logger.flush();
    const response = await logger.query({ limit: 10 });
    assert.deepEqual(
      response.logs.map((log) => log.message),
      ["before failure", "after failure"],
    );
  });

  it("flush waits for ignored fire-and-forget diagnostic writes", async () => {
    const home = await tempHome();
    const logger = new ApplicationLogger({
      dataDir: home,
      component: "test",
      level: "debug",
      mirrorToConsole: false,
    });
    await logger.hydrate();
    // Fire-and-forget: intentionally not awaited.
    void logger.info("ignored one");
    void logger.child({ component: "child" }).warn("ignored two");
    await logger.flush();
    const response = await logger.query({ limit: 10 });
    assert.deepEqual(
      response.logs.map((log) => log.message),
      ["ignored one", "ignored two"],
    );
  });
});
