import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ToolCallRecord } from "../../state/tool-types";
import { toolPresentation } from "./tool-presentation";
import { parseToolView } from "./tool-result-view";
import { toolCall } from "./tool-result-view.fixtures";

describe("parseToolView plan and web tools", () => {
  it("parses plan_mode_enter", () => {
    const view = parseToolView(
      toolCall(
        "plan_mode_enter",
        {},
        {
          mode: "planning",
          planDir: "/home/user/.nerve/plans",
          contentBlocks: [{ type: "text", text: "Plan mode active." }],
        },
      ),
    );
    assert.equal(view.kind, "plan_mode");
    if (view.kind !== "plan_mode") return;
    assert.equal(view.action, "enter");
    assert.equal(view.planPath, "/home/user/.nerve/plans");
    assert.equal(view.summary, "Plan mode active.");
  });

  it("parses plan_mode_present", () => {
    const view = parseToolView(
      toolCall(
        "plan_mode_present",
        { file_path: "/home/user/.nerve/plans/feature.md" },
        {
          review: { planPath: "/home/user/.nerve/plans/feature.md" },
          outcome: "accepted",
          feedback: "Looks good",
        },
      ),
    );
    assert.equal(view.kind, "plan_mode");
    if (view.kind !== "plan_mode") return;
    assert.equal(view.action, "present");
    assert.equal(view.planPath, "/home/user/.nerve/plans/feature.md");
    assert.equal(view.outcome, "accepted");
    assert.equal(view.summary, "Looks good");
  });

  it("parses plan_mode_force_exit", () => {
    const view = parseToolView(
      toolCall("plan_mode_force_exit", {}, { mode: "coding", reason: "Done" }),
    );
    assert.equal(view.kind, "plan_mode");
    if (view.kind !== "plan_mode") return;
    assert.equal(view.action, "force_exit");
    assert.equal(view.summary, "Done");
  });

  it("parses web_search results", () => {
    const view = parseToolView(
      toolCall(
        "web_search",
        { query: "nerve agent" },
        {
          content:
            "**Answer:** It searches.\n\n### Result\nhttps://example.test",
          details: {
            query: "nerve agent",
            answer: "It searches.",
            results: [
              {
                title: "Result",
                url: "https://example.test",
                content: "A short snippet.",
                score: 0.9,
              },
            ],
          },
        },
      ),
    );
    assert.equal(view.kind, "web_search");
    if (view.kind !== "web_search") return;
    assert.equal(view.answer, "It searches.");
    assert.equal(view.results.length, 1);
    assert.equal(view.results[0]?.content, "A short snippet.");
    assert.equal(view.results[0]?.score, 0.9);
  });

  it("offers a details action when web_search results exceed the collapsed body", () => {
    const results = Array.from({ length: 14 }, (_, index) => ({
      title: `Result ${index + 1}`,
      url: `https://example.test/${index + 1}`,
    }));
    const tc = toolCall(
      "web_search",
      { query: "many" },
      { details: { query: "many", results } },
    );
    const presentation = toolPresentation(parseToolView(tc), tc);
    assert.equal(presentation.detailsAction?.hidden, 4);
    assert.match(presentation.detailsAction?.label ?? "", /4 more results/);
  });
  it("parses web_fetch details and content", () => {
    const view = parseToolView(
      toolCall(
        "web_fetch",
        { url: "https://example.test" },
        {
          content: "# Example\n\nFetched markdown.",
          details: {
            url: "https://example.test",
            status: 200,
            contentType: "text/html; charset=utf-8",
            size: 120,
            converted: true,
          },
        },
      ),
    );
    assert.equal(view.kind, "web_fetch");
    if (view.kind !== "web_fetch") return;
    assert.equal(view.status, 200);
    assert.equal(view.converted, true);
    assert.match(view.content ?? "", /Fetched markdown/);
  });

  it("falls back to generic for a malformed result", () => {
    const view = parseToolView(
      toolCall("grep", { pattern: "x" }, "not an object"),
    );
    assert.equal(view.kind, "grep");
    if (view.kind !== "grep") return;
    assert.equal(view.matchCount, 0);
  });

  it("returns generic for unknown tools", () => {
    const view = parseToolView(
      toolCall("read", {}, undefined, {
        toolName: "mystery" as ToolCallRecord["toolName"],
      }),
    );
    assert.equal(view.kind, "generic");
  });
});
