import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  formatAgentReadyExploreReport,
  persistExploreReport,
} from "../src/domains/agents/run/explore-report-format.js";

const roots: string[] = [];
afterEach(async () =>
  Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  ),
);

describe("Explore report persistence", () => {
  it("wraps prose, preserves fenced code, and atomically reports exact size facts", async () => {
    const prose = Array.from({ length: 40 }, () => "word").join(" ");
    const markdown = `# Findings\n\n${prose}\n\n\`\`\`ts\n${"x".repeat(180)}\n\`\`\`\n`;
    const formatted = formatAgentReadyExploreReport(markdown);
    const proseLines = formatted
      .split("\n")
      .filter((line) => line.startsWith("word"));
    assert.equal(
      proseLines.every((line) => line.length <= 120),
      true,
    );
    assert.match(formatted, new RegExp(`^${"x".repeat(180)}$`, "m"));

    const root = await mkdtemp(join(tmpdir(), "nerve-explore-report-"));
    roots.push(root);
    const path = join(root, "nested", "report.md");
    const persisted = await persistExploreReport(path, markdown);
    const bytes = await readFile(path);
    assert.equal(persisted.bytes, bytes.byteLength);
    assert.equal(
      persisted.lines,
      bytes.toString("utf8").split("\n").length - 1,
    );
    assert.equal((await stat(path)).mode & 0o777, 0o600);
  });
});
