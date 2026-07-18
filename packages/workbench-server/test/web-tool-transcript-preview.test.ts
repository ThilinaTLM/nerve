import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  validatePublicEvent,
  webFetchResultDetailsSchema,
  webSearchResultDetailsSchema,
  type ToolCallRecord,
} from "@nervekit/contracts";
import { toToolCallTranscriptRecord } from "../src/domains/tools/tool-call-transcript-preview.js";

function toolCall(overrides: Partial<ToolCallRecord>): ToolCallRecord {
  return {
    id: "tool_01H00000000000000000000000",
    agentId: "agent_01H00000000000000000000000",
    conversationId: "conv_01H00000000000000000000000",
    projectId: "proj_01H0000000000000000000000",
    toolName: "web_search",
    risk: "network",
    args: {},
    cwd: "/tmp/project",
    status: "completed",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function lines(prefix: string, count: number): string {
  return Array.from(
    { length: count },
    (_, index) => `${prefix}${index + 1}`,
  ).join("\n");
}

function assertValidPublicUpdate(
  call: ToolCallRecord,
  preview: ReturnType<typeof toToolCallTranscriptRecord>,
): void {
  assert.doesNotThrow(() =>
    validatePublicEvent(
      "toolCall.updated",
      {
        conversationId: call.conversationId,
        agentId: call.agentId,
        projectId: call.projectId,
        toolCall: preview,
      },
      "workbench_server",
    ),
  );
}

describe("web tool transcript previews", () => {
  it("preserves compact web_search details after process output fields", () => {
    const results = Array.from({ length: 12 }, (_, index) => ({
      title: `Result ${index + 1}`,
      url: `https://example.test/${index + 1}`,
      content: `Snippet ${index + 1}`,
      score: 1 - index / 100,
    }));
    const duplicateOutput = "Rendered search output.\n".repeat(600);
    const call = toolCall({
      args: { query: "nerve agent" },
      result: {
        stdout: duplicateOutput,
        stderr: "",
        exitCode: 0,
        content: duplicateOutput,
        contentBlocks: [{ type: "text", text: duplicateOutput }],
        details: {
          exitCode: 0,
          durationMs: 120,
          timedOut: false,
          timeoutKilled: false,
          truncation: { truncated: true },
          streams: {},
          fullOutputPath: "/tmp/nerve-web-search.log",
          signal: null,
          query: "nerve agent",
          answer: "A concise answer.",
          results,
          outputLimits: {
            artifacts: [
              {
                kind: "full_output",
                path: "/tmp/nerve-web-search.log",
                label: "Full output",
              },
            ],
          },
        },
      },
    });

    const preview = toToolCallTranscriptRecord(call);
    const result = preview.resultPreview as Record<string, unknown>;
    const details = (result.details ?? {}) as Record<string, unknown>;
    const parsed = webSearchResultDetailsSchema.parse(details);

    assert.equal(parsed.query, "nerve agent");
    assert.equal(parsed.answer, "A concise answer.");
    assert.equal(parsed.results.length, 10);
    assert.equal(parsed.results[0]?.title, "Result 1");
    assert.equal("stdout" in result, false);
    assert.equal("content" in result, false);
    assert.equal("contentBlocks" in result, false);
    assert.equal(
      (
        details.outputLimits as {
          artifacts?: Array<{ path?: string }>;
        }
      ).artifacts?.[0]?.path,
      "/tmp/nerve-web-search.log",
    );
    assert.deepEqual(preview.previewOverflow, {
      hidden: 2,
      noun: "results",
      direction: "head",
    });
    assertValidPublicUpdate(call, preview);
  });

  it("preserves web_fetch metadata and a bounded content head", () => {
    const content = lines("fetched", 15);
    const call = toolCall({
      toolName: "web_fetch",
      args: { url: "https://example.test/article" },
      result: {
        content,
        contentBlocks: [{ type: "text", text: content }],
        details: {
          url: "https://example.test/article",
          status: 200,
          contentType: "text/html; charset=utf-8",
          size: 12_345,
          converted: true,
          savedTo: "/tmp/article.md",
          outputLimits: {
            artifacts: [
              {
                kind: "fetched_content",
                path: "/tmp/article.md",
                label: "Fetched content",
              },
            ],
          },
        },
      },
    });

    const preview = toToolCallTranscriptRecord(call);
    const result = preview.resultPreview as Record<string, unknown>;
    const details = (result.details ?? {}) as Record<string, unknown>;
    const parsed = webFetchResultDetailsSchema.parse(details);

    assert.equal(parsed.url, "https://example.test/article");
    assert.equal(parsed.status, 200);
    assert.equal(parsed.converted, true);
    assert.equal(result.content, lines("fetched", 10));
    assert.equal("contentBlocks" in result, false);
    assert.equal(
      (
        details.outputLimits as {
          artifacts?: Array<{ path?: string }>;
        }
      ).artifacts?.[0]?.path,
      "/tmp/article.md",
    );
    assert.deepEqual(preview.previewOverflow, {
      hidden: 5,
      noun: "lines",
      direction: "head",
    });
    assertValidPublicUpdate(call, preview);
  });
});
