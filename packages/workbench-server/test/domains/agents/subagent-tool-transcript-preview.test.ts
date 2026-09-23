import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AsyncSubagentToolName } from "@nervekit/contracts/agents";
import {
  subagentToolResultPreviewSchemas,
  type ToolCallRecord,
} from "@nervekit/contracts/tools";
import { buildSubagentToolTranscriptPreview } from "../../../src/domains/agents/presentation/subagent-tool-transcript-preview.js";
import { subagentToolResult } from "../../../src/domains/agents/async-subagent-tool-result.js";
import { toToolCallTranscriptRecord } from "../../../src/domains/tools/artifacts/tool-call-transcript-preview.js";
import { textOverflowStats } from "../../../src/domains/tools/artifacts/transcript-text-preview.js";

const AGENT_ID = "agent_01H00000000000000000000001";
const RUN_ID = "run_01H00000000000000000000000001";

function toolCall(
  toolName: AsyncSubagentToolName,
  details: Parameters<typeof subagentToolResult>[0] | undefined,
  overrides: Partial<ToolCallRecord> = {},
): ToolCallRecord {
  return {
    id: "tool_01H00000000000000000000000",
    agentId: "agent_01H00000000000000000000000",
    conversationId: "conv_01H00000000000000000000000",
    projectId: "proj_01H0000000000000000000000",
    toolName,
    risk: "read",
    args: { name: "ui-tests" },
    cwd: "/tmp/project",
    status: "completed",
    revision: 1,
    attempt: 1,
    interactions: [],
    settledAt: "2026-01-01T00:00:01.000Z",
    result: details ? subagentToolResult(details) : undefined,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:01.000Z",
    ...overrides,
  };
}

function status(text: string, name = "ui-tests") {
  return {
    agentId: AGENT_ID,
    name,
    state: "idle" as const,
    runId: RUN_ID,
    outcome: "completed" as const,
    response: { entryId: "entry_1", runId: RUN_ID, text, complete: true },
  };
}

describe("subagent tool transcript previews", () => {
  it("bounds a long status response by lines and drops model content", () => {
    const text = Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n");
    const record = toToolCallTranscriptRecord(
      toolCall("subagent_status", status(text)),
    );
    const preview = record.resultPreview as {
      teammate: unknown;
      response: { text: string };
    };
    assert.equal(preview.response.text.split("\n").length, 12);
    assert.equal(record.previewOverflow?.noun, "lines");
    assert.equal(record.previewOverflow?.hidden, 188);
    const serialized = JSON.stringify(preview);
    assert.ok(!serialized.includes('"content"'));
    assert.ok(!serialized.includes("entry_1"));
    assert.ok(
      subagentToolResultPreviewSchemas.subagent_status.safeParse(preview)
        .success,
    );
  });

  it("reports characters for a single very long line", () => {
    const record = toToolCallTranscriptRecord(
      toolCall("subagent_status", status("y".repeat(20_000))),
    );
    const preview = record.resultPreview as { response: { text: string } };
    assert.equal(preview.response.text.length, 1_500);
    assert.deepEqual(record.previewOverflow, {
      hidden: 18_500,
      noun: "characters",
      direction: "head",
    });
  });

  it("projects a worst-case multibyte status losslessly", () => {
    const details = status("😀".repeat(5_000), "n".repeat(80));
    const call = toolCall("subagent_status", details);
    const semantic = buildSubagentToolTranscriptPreview(
      "subagent_status",
      call.result,
    );
    const record = toToolCallTranscriptRecord(call);
    assert.deepEqual(record.resultPreview, semantic.resultPreview);
    assert.equal(record.previewOverflow?.noun, "characters");
    const response = (semantic.resultPreview as { response: { text: string } })
      .response.text;
    assert.equal(
      record.previewOverflow?.hidden,
      textOverflowStats([
        {
          value: response,
          hidden: 0,
          hiddenLines: 0,
          hiddenChars: details.response.text.length - response.length,
        },
      ]).hidden,
    );
  });

  it("bounds a worst-case list without projector loss", () => {
    const subagents = Array.from({ length: 100 }, (_, i) => ({
      agentId: `agent_01H0000000000000000000${String(i).padStart(4, "0")}`,
      name: `${String(i).padStart(3, "0")}${"n".repeat(77)}`,
      state: "running" as const,
      runId: RUN_ID,
      outcome: "interrupted" as const,
    }));
    const call = toolCall("subagent_list", {
      subagents,
      nextCursor: subagents[99]!.agentId,
    });
    const semantic = buildSubagentToolTranscriptPreview(
      "subagent_list",
      call.result,
    );
    const record = toToolCallTranscriptRecord(call);
    assert.deepEqual(record.resultPreview, semantic.resultPreview);
    const preview = record.resultPreview as {
      teammates: unknown[];
      more: boolean;
    };
    assert.equal(preview.teammates.length, 5);
    assert.equal(preview.more, true);
    assert.deepEqual(record.previewOverflow, {
      hidden: 95,
      noun: "teammates",
      direction: "head",
    });
    assert.ok(
      subagentToolResultPreviewSchemas.subagent_list.safeParse(preview).success,
    );
  });

  it("previews prompt admission as a running teammate", () => {
    const record = toToolCallTranscriptRecord(
      toolCall("subagent_prompt", {
        agentId: AGENT_ID,
        name: "ui-tests",
        runId: RUN_ID,
        accepted: true,
      }),
    );
    assert.deepEqual(record.resultPreview, {
      teammate: {
        agentId: AGENT_ID,
        name: "ui-tests",
        state: "running",
        runId: RUN_ID,
      },
      runId: RUN_ID,
    });
  });

  it("reuses stored compact previews and rebuilds legacy ones", () => {
    const call = toolCall("subagent_status", status("done"));
    const compact = toToolCallTranscriptRecord(call).resultPreview;
    const reused = toToolCallTranscriptRecord({
      ...call,
      resultPreview: compact,
    });
    assert.deepEqual(reused.resultPreview, compact);

    const legacy = { details: status("done"), content: "{}" };
    const rebuilt = toToolCallTranscriptRecord({
      ...call,
      resultPreview: legacy,
    });
    assert.deepEqual(rebuilt.resultPreview, compact);

    const metadataOnly = toToolCallTranscriptRecord({
      ...call,
      result: undefined,
      resultPreview: legacy,
    });
    assert.equal(metadataOnly.resultPreview, undefined);
  });

  it("renders legacy results without agent ids", () => {
    const { agentId: _agentId, ...legacy } = status("done");
    void _agentId;
    const record = toToolCallTranscriptRecord({
      ...toolCall("subagent_status", undefined),
      result: { details: legacy, content: JSON.stringify(legacy) },
    });
    const preview = record.resultPreview as {
      teammate: Record<string, unknown>;
    };
    assert.equal(preview.teammate.name, "ui-tests");
    assert.equal(preview.teammate.agentId, undefined);
  });
});
