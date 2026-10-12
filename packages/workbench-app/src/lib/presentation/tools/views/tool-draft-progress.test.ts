import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ConversationLiveToolDraftBlockSnapshot } from "$lib/presentation/view-models/conversation";
import { presentToolArguments } from "../lifecycle/registry";
import { summarizeToolDraft } from "./tool-draft-progress";

function summarize(toolName: string, argsText: string, extra = {}) {
  return summarizeToolDraft({
    toolName,
    argsText,
    ...extra,
  } as ConversationLiveToolDraftBlockSnapshot);
}

describe("tool draft argument projection", () => {
  it("shows the first and later unfinished write lines using lifecycle projection", () => {
    for (const argsText of [
      '{"content":"first',
      '{"content":"first\\nsecond',
    ]) {
      const summary = summarize("write", argsText);
      assert.deepEqual(
        summary.argumentBody,
        presentToolArguments("write", { argsText }, "drafting").body,
      );
      assert.equal(summary.argumentBody?.kind, "code");
      if (summary.argumentBody?.kind === "code")
        assert.equal(
          summary.argumentBody.text,
          argsText.includes("\\n") ? "first\nsecond" : "first",
        );
    }
  });

  it("keeps edit operation order, prefixes, and active partial lines", () => {
    const summary = summarize(
      "edit",
      '{"edits":[{"oldText":"old A","newText":"new A"},{"oldText":"old B","newText":"new',
    );
    assert.deepEqual(summary.argumentBody, {
      kind: "diff",
      text: "-old A\n+new A\n-old B\n+new",
      tail: true,
    });
    assert.equal(summary.operationCount, 2);
    assert.equal(summary.estimatedAdditions, 2);
    assert.equal(summary.estimatedDeletions, 2);
  });

  it("keeps six visible rows plus four overscan lines and bounded tails", () => {
    const content = Array.from({ length: 100 }, (_, i) => `line ${i}`).join(
      "\n",
    );
    const summary = summarize(
      "write",
      JSON.stringify({ content }).slice(0, -2),
    );
    assert.equal(summary.lineCount, 100);
    if (summary.argumentBody?.kind !== "code") assert.fail("expected code");
    assert.equal(
      summary.argumentBody.text,
      content.split("\n").slice(-10).join("\n"),
    );
    const long = summarize(
      "write",
      '{"content":"' + "x".repeat(50_000) + "END",
    );
    if (long.argumentBody?.kind !== "code") assert.fail("expected code");
    assert.equal(long.argumentBody.text.length, 24_000);
    assert.ok(long.argumentBody.text.endsWith("END"));
    assert.ok(long.meta.some((item) => item.text === "50003 bytes"));
  });

  it("does not truncate edit operations to the structured fallback item limit", () => {
    const edits = Array.from({ length: 20 }, (_, i) => ({
      oldText: `old ${i}`,
      newText: `new ${i}`,
    }));
    const argsText = JSON.stringify({ edits }).slice(0, -3);
    const summary = summarize("edit", argsText);
    assert.equal(summary.operationCount, 20);
    assert.equal(summary.estimatedAdditions, 20);
    assert.equal(summary.estimatedDeletions, 20);
    if (summary.argumentBody?.kind !== "diff") assert.fail("expected diff");
    assert.equal(
      summary.argumentBody.text,
      edits
        .slice(-5)
        .flatMap((edit) => [`-${edit.oldText}`, `+${edit.newText}`])
        .join("\n"),
    );
  });

  it("keeps settled argument tails at their existing six-line and 6000-character limits", () => {
    const content = Array.from({ length: 20 }, (_, i) => `line ${i}`).join(
      "\n",
    );
    const body = presentToolArguments(
      "write",
      { args: { content } },
      "completed",
    ).body;
    assert.equal(body.kind, "code");
    if (body.kind === "code")
      assert.equal(body.text, content.split("\n").slice(-6).join("\n"));
  });

  it("keeps the final character bound smaller than the drafting bound", () => {
    const content = "x".repeat(30_000) + "END";
    const final = presentToolArguments(
      "write",
      { args: { content } },
      "completed",
    ).body;
    assert.equal(final.kind, "code");
    if (final.kind === "code") {
      assert.equal(final.text.length, 6_000);
      assert.ok(final.text.endsWith("END"));
    }
    const draft = summarize("write", '{"content":"' + content).argumentBody;
    assert.equal(draft?.kind, "code");
    if (draft?.kind === "code") assert.equal(draft.text.length, 24_000);
  });

  it("preserves single-line script headers and multiline script bodies", () => {
    for (const [tool, key, language] of [
      ["bash", "command", "bash"],
      ["python_exec", "code", "python"],
    ]) {
      const single = summarize(tool, `{"${key}":"hello`);
      assert.equal(single.argumentBody?.kind, "none");
      assert.equal(single.primaryArg?.text, "hello");
      const multi = summarize(tool, `{"${key}":"hello\\nworld`);
      assert.deepEqual(
        multi.argumentBody,
        presentToolArguments(
          tool,
          { argsText: `{"${key}":"hello\\nworld` },
          "drafting",
        ).body,
      );
      assert.equal(multi.argumentBody?.kind, "code");
      if (multi.argumentBody?.kind === "code")
        assert.equal(multi.argumentBody.language, language);
    }
  });

  it("retains estimates and progress-only fallback without overriding arguments", () => {
    const progress = {
      generatedPreview: "progress",
      generatedLineCount: 8,
      estimated: true,
      operationCount: 3,
      estimatedAdditions: 8,
      estimatedDeletions: 2,
    };
    const write = summarize("write", "", { progress });
    assert.equal(write.estimated, true);
    assert.equal(write.lineCount, 8);
    assert.equal(write.argumentBody?.kind, "code");
    const edit = summarize("edit", "", { progress });
    assert.equal(edit.operationCount, 3);
    assert.deepEqual(edit.argumentBody, {
      kind: "diff",
      text: "progress",
      tail: true,
    });
    const final = summarize("write", '{"content":"stale', {
      progress,
      args: { content: "exact" },
      done: true,
    });
    assert.deepEqual(final.argumentBody, {
      kind: "code",
      text: "exact",
      language: "text",
      tail: true,
    });
    assert.equal(final.lineCount, 1);
    assert.equal(final.estimated, false);
    const empty = summarize("write", "", { progress, args: { content: "" } });
    assert.equal(empty.argumentBody?.kind, "none");
  });
});
