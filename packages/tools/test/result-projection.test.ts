import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ValidatedToolArtifact } from "@nervekit/contracts";
import type { CandidateContext } from "../src/index.js";
import {
  agentResultPolicyForTool,
  measureBlocks,
  projectAgentResult,
} from "../src/index.js";

const artifact = (path: string, id = "recovery"): ValidatedToolArtifact => ({
  version: 1,
  id,
  role: "overflow_recovery",
  access: { kind: "agent_file", path },
  availability: "available",
  format: { kind: "text", mediaType: "text/plain", encoding: "utf-8" },
  size: { bytes: 100_000 },
  recommendedTools: ["read", "grep"],
  label: "Complete output",
});

function context(
  toolName: string,
  result: unknown,
  artifacts: ValidatedToolArtifact[] = [],
): CandidateContext {
  return {
    toolName,
    args: {},
    result,
    status: "completed",
    phase: "completed",
    validatedArtifacts: artifacts,
  };
}

function text(blocks: ReturnType<typeof projectAgentResult>["blocks"]): string {
  return blocks
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
}

describe("adaptive agent tool-result projection", () => {
  it("keeps a fitting read canonical and emits exact continuation for a large read", () => {
    const small = Array.from(
      { length: 35 },
      (_, index) => `line ${index + 1}`,
    ).join("\n");
    const smallResult = {
      content: small,
      contentBlocks: [{ type: "text", text: small }],
      details: {
        range: {
          mode: "lines",
          requestedStartLine: 1,
          requestedLimit: 2000,
          sourceTotalLines: 35,
          returnedStartLine: 1,
          returnedEndLine: 35,
          returnedContentLines: 35,
          sourceEndsWithNewline: false,
        },
      },
    };
    const fitting = projectAgentResult(
      context("read", smallResult),
      agentResultPolicyForTool("read"),
    );
    assert.equal(fitting.snapshot.fastPath, true);
    assert.match(text(fitting.blocks), /Range: lines 1-35 of 35\.$/);

    const large = Array.from(
      { length: 500 },
      (_, index) => `line ${index + 1}`,
    ).join("\n");
    const largeResult = {
      content: large,
      contentBlocks: [{ type: "text", text: large }],
      details: {
        range: {
          mode: "lines",
          requestedStartLine: 1,
          requestedLimit: 2000,
          sourceTotalLines: 500,
          returnedStartLine: 1,
          returnedEndLine: 500,
          returnedContentLines: 500,
          sourceEndsWithNewline: false,
        },
      },
    };
    const projected = projectAgentResult(
      context("read", largeResult),
      agentResultPolicyForTool("read"),
    );
    const measured = measureBlocks(projected.blocks);
    assert.ok(measured.lines <= 202);
    assert.ok(measured.bytes <= 24_000);
    assert.match(text(projected.blocks), /Continue with offset=201\./);
  });

  it("uses a compact process diagnostic index with truthful recovery", () => {
    const stdout = Array.from({ length: 700 }, (_, index) =>
      index % 50 === 0 ? `error diagnostic ${index}` : `routine ${index}`,
    ).join("\n");
    const projected = projectAgentResult(
      context(
        "bash",
        { stdout, stderr: "", exitCode: 1, details: { durationMs: 10 } },
        [artifact("/tmp/stdout.txt")],
      ),
      agentResultPolicyForTool("bash"),
    );
    const measured = measureBlocks(projected.blocks);
    assert.ok(measured.lines <= 16);
    assert.ok(measured.bytes <= 4_000);
    assert.match(text(projected.blocks), /exit code 1/i);
    assert.match(text(projected.blocks), /\/tmp\/stdout\.txt/);
    assert.doesNotMatch(text(projected.blocks), /routine 0/);
  });

  it("preserves media while excluding image bytes from the text ledger", () => {
    const result = {
      contentBlocks: [
        { type: "text", text: "Read image file [image/png]" },
        { type: "image", data: "x".repeat(100_000), mimeType: "image/png" },
      ],
    };
    const projected = projectAgentResult(
      context("read", result),
      agentResultPolicyForTool("read"),
    );
    assert.equal(
      projected.blocks.some((block) => block.type === "image"),
      true,
    );
    assert.equal(
      measureBlocks(projected.blocks).bytes,
      Buffer.byteLength("Read image file [image/png]"),
    );
  });

  it("projects Explore tasks independently without a call-level ceiling", () => {
    const reports = Array.from({ length: 8 }, (_, index) => ({
      agentId: `agent_${index}`,
      task: `task ${index}`,
      status: "completed",
      report: Array.from(
        { length: 50 },
        (_, line) => `task ${index} line ${line}`,
      ).join("\n"),
      reportPath: `/tmp/report-${index}.md`,
      reportBytes: 4_000,
      reportLines: 50,
      artifactId: `report_${index}`,
      summaryPreview: `summary ${index}`,
    }));
    const projected = projectAgentResult(
      context("explore", { reports }),
      agentResultPolicyForTool("explore"),
    );
    assert.equal(projected.snapshot.perTask?.length, 8);
    assert.equal(projected.snapshot.strategy, "compound_per_task");
    assert.ok(measureBlocks(projected.blocks).lines > 200);
  });
});
