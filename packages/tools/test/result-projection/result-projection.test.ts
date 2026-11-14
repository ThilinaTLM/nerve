import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ValidatedToolArtifact } from "@nervekit/contracts/tools";
import type { CandidateContext } from "../../src/result-projection/index.js";
import { artifactNoticeLines } from "../../src/result-projection/candidate-artifacts.js";
import { formatWebFetchCandidateText } from "../../src/result-projection/candidates/web.js";
import { buildUserProjection } from "../../src/result-projection/user-projection/tool-user-projection.js";
import {
  agentResultPolicyForTool,
  measureBlocks,
  projectAgentResult,
  webFetchCandidateFitsInline,
} from "../../src/result-projection/index.js";

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

describe("ask_user transcript projection", () => {
  it("preserves multiline answers and question context beyond generic preview limits", () => {
    const answer =
      Array.from(
        { length: 25 },
        (_, i) => `${i}: ${"answer ".repeat(60)}`,
      ).join("\n") + "\nTHE END";
    const question = Array.from(
      { length: 25 },
      (_, i) => `Question ${i}: ${"context ".repeat(15)}`,
    ).join("\n");
    const args = { questions: [{ id: "q", question }] };
    const result = {
      questions: [
        { id: "q", question, answer: { option: "Yes", text: answer } },
      ],
    };
    const projection = buildUserProjection("ask_user", args, {
      content: JSON.stringify(result),
    });
    assert.deepEqual(projection.argsPreview, args);
    assert.deepEqual(projection.resultPreview, result);
    assert.equal(projection.previewOverflow, undefined);
  });

  it("still bounds oversized answers to the human-response text budget", () => {
    const answer = "A detailed answer\n".repeat(3000);
    const result = {
      questions: [{ id: "q", question: "Explain?", answer: { text: answer } }],
    };
    const projection = buildUserProjection(
      "ask_user",
      { questions: [{ id: "q", question: "Explain?" }] },
      { content: JSON.stringify(result) },
    );
    const projected = projection.resultPreview as typeof result;
    const text = projected.questions[0].answer.text;
    assert.ok(Buffer.byteLength(text, "utf8") <= 24_000);
    assert.ok(text.length > 8 * 1024);
    assert.ok(text.length < answer.length);
    assert.ok(answer.startsWith(text));
    assert.equal(projection.previewOverflow?.noun, "characters");
    assert.ok((projection.previewOverflow?.hidden ?? 0) > 0);
  });
});

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
    assert.equal(text(fitting.blocks), small);

    const large = Array.from(
      { length: 2000 },
      (_, index) => `line ${index + 1} ${"x".repeat(15)}`,
    ).join("\n");
    const largeResult = {
      content: `${large}\n\nLines 1-2000 of 2600. Next: {"offset":2001}`,
      contentBlocks: [
        {
          type: "text",
          text: `${large}\n\nLines 1-2000 of 2600. Next: {"offset":2001}`,
        },
      ],
      details: {
        range: {
          mode: "lines",
          requestedStartLine: 1,
          requestedLimit: 2000,
          sourceTotalLines: 2600,
          returnedStartLine: 1,
          returnedEndLine: 2000,
          returnedContentLines: 2000,
          sourceEndsWithNewline: false,
          nextOffset: 2001,
        },
      },
    };
    // Pages are bounded by size in the read tool; the projection keeps a full page whole.
    const page = projectAgentResult(
      context("read", largeResult),
      agentResultPolicyForTool("read"),
    );
    assert.equal(page.snapshot.fastPath, true);
    assert.match(
      text(page.blocks),
      /line 2000 x+\n\nLines 1-2000 of 2600\. Next: \{"offset":2001\}$/,
    );
  });

  it("keeps script output whole up to its budget and shows a head/tail view beyond it", () => {
    const run = (lines: number) =>
      projectAgentResult(
        context(
          "python_exec",
          {
            stdout: "",
            stderr: "",
            content: Array.from({ length: lines }, (_, index) =>
              index === 500 ? "error in the middle" : `routine ${index}`,
            ).join("\n"),
            exitCode: 0,
            details: { durationMs: 10 },
          },
          [
            artifact("/tmp/stdout.txt", "stdout"),
            artifact("/tmp/combined.txt", "combined"),
          ],
        ),
        agentResultPolicyForTool("python_exec"),
      );
    const whole = run(500);
    assert.equal(whole.snapshot.profile, "script_output");
    assert.equal(whole.snapshot.fastPath, true);

    const projected = run(3000);
    const shown = text(projected.blocks);
    const measured = measureBlocks(projected.blocks);
    assert.ok(measured.lines <= 200);
    assert.ok(measured.bytes <= 8_000);
    assert.match(shown, /^exit 0\nroutine 0\n/);
    assert.match(
      shown,
      /routine 2999\n\[Showing lines 1-\d+ and \d+-3000 of 3000;/,
    );
    assert.match(shown, /Full output: \/tmp\/combined\.txt\]$/);
    assert.doesNotMatch(shown, /stdout\.txt|error in the middle/);
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
      /Showing (\d+) of 150 entries\. List a subdirectory/,
    );
    assert.ok(notice);
    assert.ok(Number(notice[1]) < 150);
    assert.doesNotMatch(output, /"limit"/);
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

  it("ends a cut grep with a narrowing summary, not a limit hint", () => {
    const matches = Array.from({ length: 100 }, (_, index) => ({
      path:
        index < 70 ? "src/a.ts" : index < 90 ? "src/b.ts" : `src/c${index}.ts`,
      line: index + 1,
      text: `match ${index + 1}`,
    }));
    const projected = projectAgentResult(
      context("grep", {
        path: ".",
        matches,
        details: { totalMatches: 340, producerLimitReached: true },
      }),
      agentResultPolicyForTool("grep"),
    );
    const output = text(projected.blocks);
    assert.match(
      output,
      /Showing \d+ of 340 matches\. By file \(first 100\): src\/a\.ts 70, src\/b\.ts 20, src\/c90\.ts 1, 9 other files 9\. Narrow with path, glob or a tighter pattern\.$/,
    );
    assert.doesNotMatch(output, /limit/i);
    assert.ok(measureBlocks(projected.blocks).lines <= 80);
  });

  it("keeps grep context lines with their match, including when cut", () => {
    const matches = Array.from({ length: 40 }, (_, index) => ({
      path: "a.py",
      line: index * 10 + 2,
      text: `def f${index}():`,
    }));
    const content = matches
      .map((m) =>
        [
          `a.py-${m.line - 1}- # before ${m.line}`,
          `a.py:${m.line}: ${m.text}`,
          `a.py-${m.line + 1}-     return ${m.line}`,
        ].join("\n"),
      )
      .join("\n--\n");
    const projected = projectAgentResult(
      {
        ...context("grep", {
          path: ".",
          matches,
          content,
          details: { totalMatches: 40 },
        }),
        args: { pattern: "def ", context: 1 },
      },
      agentResultPolicyForTool("grep"),
    );
    const output = text(projected.blocks);
    assert.match(
      output,
      /a\.py-1- # before 2\na\.py:2: def f0\(\):\na\.py-3- {5}return 2\na\.py-11- # before 12\n/,
    );
    assert.doesNotMatch(output, /^--$/m);
    const lastShown = Number(
      /a\.py:(\d+): def f\d+\(\):\n(?![\s\S]*a\.py:\d+: def)/.exec(output)?.[1],
    );
    assert.match(
      output,
      new RegExp(`a\\.py-${lastShown + 1}-     return ${lastShown}`),
    );
    assert.match(output, /Showing \d+ of 40 matches/);
    assert.ok(measureBlocks(projected.blocks).lines <= 80);
  });

  it("pluralizes omitted grep matches correctly", () => {
    const matches = Array.from({ length: 80 }, (_, index) => ({
      path: "src/file.ts",
      line: index + 1,
      text: `match ${index + 1} ${"x".repeat(200)}`,
    }));
    const projected = projectAgentResult(
      context("grep", {
        path: ".",
        matches,
        details: { totalMatches: matches.length },
      }),
      agentResultPolicyForTool("grep"),
    );
    const output = text(projected.blocks);
    assert.match(output, /matches/);
    assert.doesNotMatch(output, /matchs/);
  });

  it("formats web metadata compactly before the body", () => {
    const output = formatWebFetchCandidateText(
      {
        url: "https://example.com/page",
        status: 200,
        contentType: "text/html",
        size: 42,
        converted: true,
      },
      "Body text",
    );
    assert.equal(
      output,
      "URL: https://example.com/page\nHTTP status: 200\nContent-Type: text/html\nBytes: 42\nConverted: markdown\n\nBody text",
    );
  });

  it("preserves user review feedback as a human response", () => {
    const feedback =
      "Keep the exact cursor boundary and rename the final section.";
    const projected = projectAgentResult(
      context("plan_present", {
        content: feedback,
        details: {
          reviewId: "review_1",
          planPath: "/tmp/plan.md",
          decision: "changes_requested",
          feedback,
        },
      }),
      agentResultPolicyForTool("plan_present"),
    );
    const output = text(projected.blocks);
    assert.match(output, /review_1/);
    assert.match(output, /changes_requested/);
    assert.match(output, new RegExp(feedback));
  });

  it("shows ask_user answers and dismissals readably to the agent", () => {
    const project = (result: object) =>
      text(
        projectAgentResult(
          context("ask_user", { content: JSON.stringify(result) }),
          agentResultPolicyForTool("ask_user"),
        ).blocks,
      );
    assert.equal(project({ question: "Which?", response: "Blue" }), "Blue");
    assert.match(
      project({ question: "Which?", dismissed: true }),
      /user dismissed the question/,
    );
  });

  it("distinguishes denial sources and preserves cancellation outcomes", () => {
    const terminal = (
      status: CandidateContext["status"],
      denialSource?: CandidateContext["denialSource"],
    ) =>
      text(
        projectAgentResult({
          ...context("bash", undefined),
          status,
          phase: status === "cancelled" ? "cancelled" : "denied",
          error: "Terminal reason.",
          denialSource,
        }).blocks,
      );

    assert.equal(terminal("denied", "user"), "bash: denied by user, not run.");
    assert.equal(
      terminal("denied", "policy"),
      "bash: denied by policy, not run. Terminal reason.",
    );
    assert.equal(terminal("denied"), "bash: denied, not run. Terminal reason.");
    assert.equal(
      terminal("cancelled"),
      "bash: cancelled, no rollback implied. Terminal reason.",
    );
  });

  it("renders failures as one line with plain errno wording", () => {
    const failed = (toolName: string, error: string) =>
      text(
        projectAgentResult({
          ...context(toolName, undefined),
          status: "failed",
          error,
        }).blocks,
      );
    assert.equal(
      failed("read", "read path not found: a/b.ts"),
      "read: path not found: a/b.ts",
    );
    assert.equal(
      failed("edit", "ENOENT: no such file or directory, open '/x/y'"),
      "edit: path not found: /x/y",
    );
    assert.equal(
      failed(
        "python_exec",
        "Unknown system error -122: Unknown system error -122, write",
      ),
      "python_exec: disk quota exceeded; cannot write",
    );
    assert.equal(
      text(
        projectAgentResult({
          ...context("bash", undefined),
          status: "failed",
          phase: "interrupted",
        }).blocks,
      ),
      "bash: interrupted, no rollback implied.",
    );
  });
});

describe("saved file notices", () => {
  it("say the content is in a file and how to open it", () => {
    const saved = {
      ...artifact("/data/page.md", "fetched_content", "primary_result"),
      label: "Fetched content",
      size: { bytes: 210_533, lines: 3120 },
    };
    assert.deepEqual(artifactNoticeLines([saved], "primary_result"), [
      "Fetched content (3120 lines) saved to /data/page.md; read or grep it.",
    ]);
  });
});

describe("process footer scope", () => {
  it("adds no exit footer to web_search results", () => {
    const projected = projectAgentResult({
      ...context("web_search", {
        content: "hello",
        exitCode: 0,
        details: { exitCode: 0 },
      }),
    });
    assert.doesNotMatch(text(projected.blocks), /exit 0/);
  });
});
