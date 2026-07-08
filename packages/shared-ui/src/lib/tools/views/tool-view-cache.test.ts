import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ToolCallRecord } from "../../state/tool-types";
import { toolPresentation, toolPresentationCached } from "./tool-presentation";
import { parseToolView, parseToolViewCached } from "./tool-result-view";

function toolCall(overrides: Partial<ToolCallRecord> = {}): ToolCallRecord {
  return {
    id: "tool_01H00000000000000000000000",
    agentId: "agent_01H00000000000000000000000",
    conversationId: "conv_01H00000000000000000000000",
    projectId: "proj_01H0000000000000000000000",
    toolName: "read",
    risk: "read",
    args: { path: "src/App.svelte" },
    cwd: "/tmp/project",
    status: "completed",
    result: { path: "src/App.svelte", content: "hello\nworld" },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("tool view caching", () => {
  it("returns the same parsed view for an unchanged tool call", () => {
    const tc = toolCall({ id: "tool_cacheprobe_aaaaaaaaaaaaaa" });
    const first = parseToolViewCached(tc);
    const second = parseToolViewCached(tc);
    assert.ok(Object.is(first, second), "cache hit returns same view object");
    // Content matches a fresh uncached parse.
    assert.deepEqual(parseToolView(tc), first);
  });

  it("recomputes when the tool-call revision (updatedAt) changes", () => {
    const id = "tool_cacheprobe_bbbbbbbbbbbbbb";
    const first = parseToolViewCached(toolCall({ id }));
    const updated = parseToolViewCached(
      toolCall({ id, updatedAt: "2026-01-01T00:00:01.000Z" }),
    );
    assert.ok(!Object.is(first, updated), "new revision bypasses the cache");
  });

  it("memoizes presentation by the cached view object", () => {
    const tc = toolCall({ id: "tool_cacheprobe_cccccccccccccc" });
    const view = parseToolViewCached(tc);
    const p1 = toolPresentationCached(view, tc);
    const p2 = toolPresentationCached(view, tc);
    assert.ok(Object.is(p1, p2), "presentation cache hit returns same object");
    assert.deepEqual(toolPresentation(view, tc), p1);
  });
});
