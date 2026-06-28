import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { ApplicationLogger, serializeError } from "../src/infrastructure/diagnostics/index.js";

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
});
