import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { ApplicationLogger } from "../src/logging.js";

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
});
