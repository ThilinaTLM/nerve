import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ConversationLiveToolOutputSnapshot } from "@nervekit/contracts/conversations";
import { parseToolView } from "./tool-result-view";
import { toolCall } from "./tool-result-view.fixtures";

const liveOutput: ConversationLiveToolOutputSnapshot = {
  toolCallId: "tool_01H00000000000000000000000",
  chunks: [
    {
      stream: "thinking",
      text: "Inspecting the layout. ",
      ts: "2026-01-01T00:00:01.000Z",
    },
    {
      stream: "thinking",
      text: "Reading labels.",
      ts: "2026-01-01T00:00:02.000Z",
    },
    {
      stream: "text",
      text: "## Screenshot\n",
      ts: "2026-01-01T00:00:03.000Z",
    },
    {
      stream: "text",
      text: "A settings page.",
      ts: "2026-01-01T00:00:04.000Z",
    },
  ],
  text: "Inspecting the layout. Reading labels.## Screenshot\nA settings page.",
  updatedAt: "2026-01-01T00:00:04.000Z",
};

describe("parseToolView explain_image", () => {
  it("keeps live thinking and explanation channels separate", () => {
    const view = parseToolView(
      toolCall("explain_image", { path: "screen.png" }, undefined, {
        status: "running",
      }),
      liveOutput,
    );
    assert.equal(view.kind, "explain_image");
    if (view.kind !== "explain_image") return;
    assert.equal(view.live, true);
    assert.equal(view.thinking, "Inspecting the layout. Reading labels.");
    assert.equal(view.liveExplanation, "## Screenshot\nA settings page.");
    assert.equal(view.explanation, undefined);
  });

  it("replaces transient progress with the durable completed explanation", () => {
    const explanation = "## Screenshot\n\n- A settings page";
    const view = parseToolView(
      toolCall(
        "explain_image",
        { path: "screen.png" },
        {
          content: explanation,
          details: {
            path: "/tmp/project/screen.png",
            mimeType: "image/png",
            byteSize: 128,
            model: { provider: "google", modelId: "gemini" },
            explanation,
          },
        },
      ),
      liveOutput,
    );
    assert.equal(view.kind, "explain_image");
    if (view.kind !== "explain_image") return;
    assert.equal(view.live, false);
    assert.equal(view.explanation, explanation);
    assert.equal(view.thinking, undefined);
    assert.equal(view.liveExplanation, undefined);
  });

  it("falls back to legacy text results", () => {
    const view = parseToolView(
      toolCall(
        "explain_image",
        { path: "screen.png" },
        { content: "A legacy explanation." },
      ),
    );
    assert.equal(view.kind, "explain_image");
    if (view.kind !== "explain_image") return;
    assert.equal(view.explanation, "A legacy explanation.");
  });
});
