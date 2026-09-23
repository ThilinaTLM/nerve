import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toolPresentation } from "./tool-presentation";
import { parseToolView } from "./tool-result-view";
import {
  metaText,
  present,
  presentTranscript,
  toolCall,
  transcriptToolCall,
} from "./tool-result-view.fixtures";
import { teammateStateLabel, teammateTone } from "./subagent-result-parser";

const teammate = {
  agentId: "agent_child",
  name: "ui-tests",
  state: "idle" as const,
  outcome: "completed" as const,
  runId: "run_1",
};

describe("parseToolView subagent tools", () => {
  it("renders a compact status preview with response and line overflow", () => {
    const tc = transcriptToolCall(
      "subagent_status",
      { name: "ui-tests" },
      {
        teammate,
        response: { text: "Done.\nAll pass.", complete: true, runId: "run_1" },
      },
      { previewOverflow: { hidden: 40, noun: "lines", direction: "head" } },
    );
    const view = parseToolView(tc);
    assert.equal(view.kind, "subagent");
    if (view.kind !== "subagent") return;
    assert.equal(view.action, "status");
    assert.deepEqual(view.teammates, [teammate]);
    assert.equal(view.response?.text, "Done.\nAll pass.");
    assert.deepEqual(view.hidden, { count: 40, noun: "lines" });

    const presentation = toolPresentation(view, tc);
    assert.equal(presentation.primaryArg?.text, "ui-tests");
    assert.deepEqual(metaText(presentation.meta), [
      "completed",
      "40 more lines",
    ]);
    assert.equal(presentation.detailsAction?.hidden, 40);
  });

  it("flags partial responses and character overflow", () => {
    const presentation = presentTranscript(
      "subagent_status",
      { name: "ui-tests" },
      {
        teammate: { ...teammate, outcome: "failed" },
        response: { text: "x", complete: false, runId: "run_1" },
      },
      {
        previewOverflow: { hidden: 900, noun: "characters", direction: "head" },
      },
    );
    assert.deepEqual(
      presentation.meta.map((item) => [item.text, item.tone]),
      [
        ["failed", "destructive"],
        ["partial response", "warning"],
        ["900 more characters", undefined],
      ],
    );
  });

  it("counts listed teammates including hidden ones", () => {
    const tc = transcriptToolCall(
      "subagent_list",
      {},
      {
        teammates: [
          { ...teammate, state: "running", outcome: undefined },
          { agentId: "agent_b", name: "api", state: "idle" },
        ],
        more: true,
      },
      { previewOverflow: { hidden: 3, noun: "teammates", direction: "head" } },
    );
    const view = parseToolView(tc);
    const presentation = toolPresentation(view, tc);
    assert.equal(presentation.primaryArg?.text, "5 teammates");
    assert.deepEqual(metaText(presentation.meta), [
      "1 running",
      "more available",
      "3 more teammates",
    ]);
  });

  it("parses a complete durable result for the details dialog", () => {
    const view = parseToolView(
      toolCall(
        "subagent_prompt",
        { name: "ui-tests", prompt: "Write tests" },
        {
          details: {
            agentId: "agent_child",
            name: "ui-tests",
            runId: "run_2",
            accepted: true,
          },
          content: "{}",
        },
      ),
    );
    assert.equal(view.kind, "subagent");
    if (view.kind !== "subagent") return;
    assert.equal(view.runId, "run_2");
    assert.deepEqual(view.teammates, [
      {
        agentId: "agent_child",
        name: "ui-tests",
        state: "running",
        runId: "run_2",
      },
    ]);
    const presentation = present(
      "subagent_prompt",
      { name: "ui-tests", prompt: "Write tests" },
      { details: { name: "ui-tests", runId: "run_2", accepted: true } },
    );
    assert.deepEqual(metaText(presentation.meta), ["assignment started"]);
  });

  it("falls back to the argument name while pending and flags metadata-only records", () => {
    const pending = parseToolView(
      toolCall("subagent_new", { name: "api" }, undefined, {
        status: "running",
      }),
    );
    assert.equal(
      pending.kind === "subagent" && pending.previewUnavailable,
      false,
    );
    assert.deepEqual(pending.kind === "subagent" && pending.teammates, [
      { name: "api" },
    ]);

    const metadataOnly = parseToolView(
      transcriptToolCall("subagent_new", { name: "api" }, undefined),
    );
    assert.equal(
      metadataOnly.kind === "subagent" && metadataOnly.previewUnavailable,
      true,
    );
  });

  it("maps teammate state and outcome to tones and labels", () => {
    assert.equal(teammateTone({ name: "a", state: "running" }), "info");
    assert.equal(teammateTone({ name: "a", state: "stopping" }), "warning");
    assert.equal(
      teammateTone({ name: "a", state: "idle", outcome: "interrupted" }),
      "warning",
    );
    assert.equal(teammateTone({ name: "a", state: "idle" }), "neutral");
    assert.equal(teammateStateLabel({ name: "a", state: "idle" }), "idle");
    assert.equal(
      teammateStateLabel({ name: "a", state: "idle", outcome: "completed" }),
      "completed",
    );
    assert.equal(teammateStateLabel({ name: "a" }), "pending");
  });
});
