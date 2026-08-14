import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  buildPerformanceSummary,
  formatMarkdown,
  readJsonLines,
} from "./summarize-performance-jsonl.mjs";

const roots = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

async function fixture(name, content) {
  const root = await mkdtemp(join(tmpdir(), "nerve-performance-summary-"));
  roots.push(root);
  const path = join(root, name);
  await writeFile(path, content, "utf8");
  return path;
}

describe("performance JSONL summary", () => {
  it("summarizes startup phases, store timings, and process metrics", async () => {
    const startup = await fixture(
      "startup.jsonl",
      [
        {
          type: "nerve.startup",
          source: "daemon",
          listeningDurationMs: 300,
          storeDurationsMs: { tasks: 100 },
        },
        {
          type: "nerve.startup",
          source: "daemon",
          listeningDurationMs: 100,
          storeDurationsMs: { tasks: 50 },
        },
        {
          type: "nerve.startup",
          source: "daemon",
          listeningDurationMs: 200,
          storeDurationsMs: { tasks: 75 },
          secret: "ignored",
        },
        { type: "nerve.startup", source: "desktop", totalMs: 400 },
      ]
        .map((record) => JSON.stringify(record))
        .join("\n") + "\n",
    );
    const performance = await fixture(
      "performance.jsonl",
      [
        {
          type: "nerve.performance",
          source: "daemon",
          cpuPercent: 1,
          rssBytes: 100,
          heapUsedBytes: 50,
        },
        {
          type: "nerve.performance",
          source: "daemon",
          cpuPercent: 3,
          rssBytes: 160,
          heapUsedBytes: 70,
        },
        {
          type: "nerve.performance",
          source: "desktop",
          processes: [
            { role: "Tab", cpuPercent: 10, rssBytes: 200 },
            { role: "GPU", cpuPercent: 2, rssBytes: 80 },
          ],
        },
        {
          type: "nerve.performance",
          source: "desktop",
          processes: [{ role: "Tab", cpuPercent: 20, rssBytes: 260 }],
        },
      ]
        .map((record) => JSON.stringify(record))
        .join("\n") + "\n",
    );

    const summary = await buildPerformanceSummary({ startup, performance });
    assert.equal(summary.startup.daemon.listeningDurationMs.median, 200);
    assert.equal(summary.startup.daemon["store.tasks"].average, 75);
    assert.equal(summary.performance["daemon:daemon"].cpuPercent.average, 2);
    assert.equal(summary.performance["daemon:daemon"].rssBytes.growth, 60);
    assert.equal(summary.performance["desktop:Tab"].cpuPercent.p95, 20);
    assert.equal(summary.performance["desktop:Tab"].rssBytes.growth, 60);
    assert.equal(JSON.stringify(summary).includes("secret"), false);

    const markdown = formatMarkdown(summary);
    assert.match(markdown, /store\.tasks/);
    assert.match(markdown, /desktop:Tab/);
  });

  it("accepts a valid final line and ignores one torn final line", async () => {
    const valid = await fixture("valid.jsonl", '{"value":1}');
    const torn = await fixture("torn.jsonl", '{"value":1}\n{"value":');
    const values = [];
    await readJsonLines(valid, (record) => values.push(record.value));
    await readJsonLines(torn, (record) => values.push(record.value));
    assert.deepEqual(values, [1, 1]);
  });

  it("rejects malformed interior records", async () => {
    const path = await fixture(
      "malformed.jsonl",
      '{"value":1}\nnot-json\n{"value":2}\n',
    );
    await assert.rejects(
      readJsonLines(path, () => undefined),
      /:2/,
    );
  });

  it("returns empty sections for empty inputs", async () => {
    const startup = await fixture("startup.jsonl", "");
    const performance = await fixture("performance.jsonl", "");
    assert.deepEqual(await buildPerformanceSummary({ startup, performance }), {
      startup: {},
      performance: {},
    });
  });
});
