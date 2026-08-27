import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ValidatedToolArtifact } from "@nervekit/contracts";
import type { CandidateContext } from "../src/index.js";
import {
  agentResultPolicyForTool,
  measureBlocks,
  projectAgentResult,
  webFetchCandidateFitsInline,
} from "../src/index.js";

const artifact = (
  path: string,
  id = "recovery",
  role: ValidatedToolArtifact["role"] = "overflow_recovery",
  format: ValidatedToolArtifact["format"]["kind"] = "text",
): ValidatedToolArtifact => ({
  version: 1,
  id,
  role,
  access: { kind: "agent_file", path },
  availability: "available",
  format: {
    kind: format,
    mediaType:
      format === "json"
        ? "application/json"
        : format === "jsonl"
          ? "application/x-ndjson"
          : "text/plain",
    encoding: "utf-8",
  },
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
        {
          stdout,
          stderr: "",
          exitCode: 1,
          details: {
            durationMs: 10,
            streams: { combined: { lines: 700, bytes: 20_000 } },
          },
        },
        [
          artifact("/tmp/stdout.txt", "stdout"),
          artifact("/tmp/stderr.txt", "stderr"),
        ],
      ),
      agentResultPolicyForTool("bash"),
    );
    const measured = measureBlocks(projected.blocks);
    assert.ok(measured.lines <= 16);
    assert.ok(measured.bytes <= 4_000);
    assert.match(text(projected.blocks), /exit code 1/i);
    assert.match(text(projected.blocks), /\/tmp\/stdout\.txt/);
    assert.match(text(projected.blocks), /\/tmp\/stderr\.txt/);
    assert.match(text(projected.blocks), /of 700 diagnostic lines/);
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

  it("uses the exact network candidate budget for web prose", () => {
    const details = {
      url: "https://example.com/large",
      status: 200,
      contentType: "text/plain",
      size: 20_000,
      converted: false,
    };
    assert.equal(webFetchCandidateFitsInline(details, "small body"), true);
    assert.equal(
      webFetchCandidateFitsInline(details, "x".repeat(20_000)),
      false,
    );
  });

  it("reports exact listing selection counts and recovery guidance", () => {
    const entries = Array.from({ length: 150 }, (_, index) => ({
      path: `item-${String(index + 1).padStart(3, "0")}.txt`,
      kind: "file",
    }));
    const projected = projectAgentResult(
      context(
        "ls",
        { path: "/tmp/list", entries, details: { totalEntries: 150 } },
        [artifact("/tmp/list-result.json")],
      ),
      agentResultPolicyForTool("ls"),
    );
    const output = text(projected.blocks);
    const notice = output.match(
      /Showing (\d+) of 150 entries; (\d+) omitted\./,
    );
    assert.ok(notice);
    assert.equal(Number(notice[1]) + Number(notice[2]), 150);
    assert.doesNotMatch(output, /bounded selection/);
    assert.match(output, /\/tmp\/list-result\.json/);
    assert.ok(measureBlocks(projected.blocks).lines <= 120);
  });

  it("returns file mutation facts without replaying submitted content", () => {
    const projected = projectAgentResult(
      context("write", {
        path: "/tmp/file.txt",
        content: "Wrote 12 bytes.",
        details: {
          bytesWritten: 12,
          mutationSummary: {
            operation: "write",
            outcome: "succeeded",
            resources: [{ kind: "file", path: "/tmp/file.txt" }],
            warnings: [],
          },
        },
      }),
      agentResultPolicyForTool("write"),
    );
    const output = text(projected.blocks);
    assert.match(output, /Outcome: succeeded/);
    assert.match(output, /Bytes written: 12/);
    assert.match(output, /\/tmp\/file\.txt/);
    assert.doesNotMatch(output, /submitted body/);
  });

  it("projects todos exactly once", () => {
    const projected = projectAgentResult(
      context("todos_get", {
        content: "- [ ] alpha\n- [x] beta",
        contentBlocks: [{ type: "text", text: "- [ ] alpha\n- [x] beta" }],
        details: {
          todos: [
            { todo: "alpha", done: false },
            { todo: "beta", done: true },
          ],
        },
      }),
      agentResultPolicyForTool("todos_get"),
    );
    const output = text(projected.blocks);
    assert.equal(output.match(/alpha/g)?.length, 1);
    assert.equal(output.match(/beta/g)?.length, 1);
  });

  it("keeps task lifecycle termination and control outcome actionable", () => {
    const projected = projectAgentResult(
      context("task_control", {
        action: "stop",
        task: {
          id: "task_test",
          name: "probe",
          status: "failed",
          readiness: { outcome: "ready" },
          exitCode: 5,
          signal: "SIGTERM",
          finishedAt: "2026-08-27T00:00:00.000Z",
          error: "probe failed",
        },
        result: {
          outcome: "already_terminal",
          message: "Task had already stopped.",
        },
      }),
      agentResultPolicyForTool("task_control"),
    );
    const output = text(projected.blocks);
    assert.match(output, /already_terminal/);
    assert.match(output, /exit: 5/);
    assert.match(output, /SIGTERM/);
    assert.match(output, /probe failed/);
  });

  it("keeps incremental task logs at the earliest fitting events", () => {
    const events = Array.from({ length: 100 }, (_, index) => ({
      seq: index + 1,
      stream: "stdout",
      level: "info",
      line: `event-${index + 1} ${"x".repeat(600)}`,
      raw: { start: index * 610, end: (index + 1) * 610 },
    }));
    const result = {
      task: { id: "task_test", name: "probe", status: "running" },
      events,
      mode: "since_cursor",
      originalEventCount: 100,
      hasMoreBefore: false,
      hasMoreAfter: false,
      streamArtifacts: {
        stdoutPath: "/tmp/stdout.txt",
        stderrPath: "/tmp/stderr.txt",
        eventsPath: "/tmp/events.jsonl",
        fidelity: "captured",
      },
    };
    const projected = projectAgentResult(
      context("task_logs", result, [
        artifact("/tmp/stdout.txt", "task_stdout"),
        artifact(
          "/tmp/events.jsonl",
          "task_events",
          "supporting_data",
          "jsonl",
        ),
      ]),
      agentResultPolicyForTool("task_logs"),
    );
    const output = text(projected.blocks);
    assert.match(output, /\n1 \[stdout\]/);
    assert.doesNotMatch(output, /\n100 \[stdout\]/);
    const cursor = projected.snapshot.continuation?.find(
      (item) => item.kind === "cursor" && item.cursorName === "sinceSeq",
    );
    assert.ok(cursor?.kind === "cursor");
    assert.ok(Number(cursor.value) < 100);
    assert.match(output, new RegExp(`sinceSeq=${String(cursor.value)}`));
    assert.ok(measureBlocks(projected.blocks).bytes <= 10_000);
  });

  it("anchors first-failure task logs and exposes the event index", () => {
    const events = Array.from({ length: 41 }, (_, index) => ({
      seq: index + 1,
      stream: "stderr",
      level: index === 20 ? "error" : "info",
      line: `${index === 20 ? "failure" : "context"}-${index + 1} ${"x".repeat(600)}`,
      raw: { start: index * 610, end: (index + 1) * 610 },
    }));
    const projected = projectAgentResult(
      context(
        "task_logs",
        {
          task: {
            id: "task_test",
            name: "probe",
            status: "failed",
            exitCode: 1,
          },
          events,
          mode: "first_failure",
          originalEventCount: 41,
          hasMoreBefore: false,
          hasMoreAfter: false,
        },
        [
          artifact("/tmp/stderr.txt", "task_stderr"),
          artifact(
            "/tmp/events.jsonl",
            "task_events",
            "supporting_data",
            "jsonl",
          ),
        ],
      ),
      agentResultPolicyForTool("task_logs"),
    );
    const output = text(projected.blocks);
    assert.match(output, /21 \[stderr\] failure-21/);
    assert.match(output, /Full event index: \/tmp\/events\.jsonl/);
  });

  it("keeps recent task logs at the newest fitting events with backward recovery", () => {
    const events = Array.from({ length: 100 }, (_, index) => ({
      seq: index + 1,
      stream: "stdout",
      level: "info",
      line: `event-${index + 1} ${"x".repeat(600)}`,
      raw: { start: index * 610, end: (index + 1) * 610 },
    }));
    const projected = projectAgentResult(
      context(
        "task_logs",
        {
          task: {
            id: "task_test",
            name: "probe",
            status: "completed",
            exitCode: 0,
          },
          events,
          mode: "recent",
          originalEventCount: 100,
          hasMoreBefore: false,
          hasMoreAfter: false,
          streamArtifacts: {
            stdoutPath: "/tmp/stdout.txt",
            stderrPath: "/tmp/stderr.txt",
            eventsPath: "/tmp/events.jsonl",
            fidelity: "captured",
          },
        },
        [artifact("/tmp/stdout.txt", "task_stdout")],
      ),
      agentResultPolicyForTool("task_logs"),
    );
    const output = text(projected.blocks);
    assert.match(output, /\n100 \[stdout\]/);
    assert.doesNotMatch(output, /\n1 \[stdout\]/);
    assert.match(output, /beforeSeq=/);
    assert.match(output, /exit: 0/);
  });

  it("preserves search totals, continuation, and validated supporting data", () => {
    const issues = Array.from({ length: 12 }, (_, index) => ({
      key: `NER-${index + 1}`,
      summary: `Issue ${index + 1}`,
      status: "To Do",
    }));
    const projected = projectAgentResult(
      context(
        "jira_search_issues",
        {
          details: {
            jql: "project = NER",
            issues,
            total: 20,
            nextPageToken: "next-token",
          },
        },
        [
          artifact(
            "/tmp/issues.json",
            "jira_raw_json",
            "supporting_data",
            "json",
          ),
        ],
      ),
      agentResultPolicyForTool("jira_search_issues"),
    );
    const output = text(projected.blocks);
    assert.match(output, /Showing 10 of 20 results; 10 omitted/);
    assert.match(output, /nextPageToken=next-token/);
    assert.match(output, /\/tmp\/issues\.json/);
    assert.doesNotMatch(output, /NER-11/);
  });

  it("does not render an unvalidated primary file path", () => {
    const projected = projectAgentResult(
      context("jira_download_attachment", {
        details: {
          action: "download_attachment",
          attachmentId: "100",
          filename: "secret.bin",
          mediaType: "application/octet-stream",
          bytes: 20,
          path: "/tmp/untrusted.bin",
        },
      }),
      agentResultPolicyForTool("jira_download_attachment"),
    );
    assert.doesNotMatch(text(projected.blocks), /untrusted\.bin/);
  });

  it("renders validated Confluence bundle artifacts", () => {
    const projected = projectAgentResult(
      context(
        "confluence_download_page",
        {
          details: {
            action: "download_page",
            bodyFormat: "storage",
            downloadDir: "/tmp/bundle",
            pageCount: 2,
            includedCounts: { downloadedAttachments: 1 },
          },
        },
        [
          artifact(
            "/tmp/bundle/manifest.json",
            "manifest",
            "primary_result",
            "json",
          ),
          artifact(
            "/tmp/bundle/pages.jsonl",
            "pages",
            "primary_result",
            "jsonl",
          ),
        ],
      ),
      agentResultPolicyForTool("confluence_download_page"),
    );
    const output = text(projected.blocks);
    assert.match(output, /pageCount: 2/);
    assert.match(output, /manifest\.json/);
    assert.match(output, /pages\.jsonl/);
    assert.match(output, /downloadedAttachments: 1/);
  });

  it("keeps resource summaries semantic and caps related previews at three", () => {
    const projected = projectAgentResult(
      context("jira_get_board", {
        details: {
          action: "get_board",
          boardId: "34",
          board: { id: "34", name: "Board", type: "simple" },
          backlogIssues: Array.from({ length: 5 }, (_, index) => ({
            key: `NER-${index + 1}`,
            summary: `Issue ${index + 1}`,
          })),
          backlogCount: 5,
          outputLimits: { artifacts: [{ id: "raw" }] },
          streams: { stdout: { bytes: 100 } },
          exitCode: 0,
        },
      }),
      agentResultPolicyForTool("jira_get_board"),
    );
    const output = text(projected.blocks);
    assert.match(output, /backlogIssues: showing 3 of 5; 2 omitted/);
    assert.match(output, /NER-3/);
    assert.doesNotMatch(output, /NER-4/);
    assert.doesNotMatch(output, /outputLimits|streams|exitCode/);
  });

  it("preserves transition discovery in dry-run acknowledgements", () => {
    const projected = projectAgentResult(
      context("jira_transition_issue", {
        content: "Available transitions for NER-19.",
        contentBlocks: [
          { type: "text", text: "Available transitions for NER-19." },
        ],
        details: {
          issueKey: "NER-19",
          dryRun: true,
          transitions: [
            { id: "1", name: "Start Progress", toStatus: "In Progress" },
            { id: "2", name: "Done", toStatus: "Done" },
          ],
        },
      }),
      agentResultPolicyForTool("jira_transition_issue"),
    );
    const output = text(projected.blocks);
    assert.match(output, /Available transitions/);
    assert.match(output, /Start Progress/);
    assert.match(output, /Done/);
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
