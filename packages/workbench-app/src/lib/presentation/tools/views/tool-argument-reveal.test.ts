import assert from "node:assert/strict";
import { test } from "node:test";
import type { ConversationLiveToolDraftBlockSnapshot } from "../../view-models/live";
import {
  jsonTextRevealBoundary,
  pacedDraftBlock,
  ToolArgumentHandoff,
} from "./tool-argument-reveal";

function draft(argsText: string): ConversationLiveToolDraftBlockSnapshot {
  return {
    kind: "tool_call_draft",
    contentBlockId: "turn:0",
    contentIndex: 0,
    toolName: "write",
    argsText,
    progressRevision: 0,
    done: false,
  };
}

test("reveal withholds incomplete escapes even at the received source end", () => {
  for (const suffix of ["\\", "\\u", "\\u0", "\\u00", "\\u004"]) {
    const text = '{"content":"hi' + suffix;
    assert.equal(jsonTextRevealBoundary(text, text.length), 14);
  }
  const escapedSlash = '{"content":"hi\\\\';
  assert.equal(
    jsonTextRevealBoundary(escapedSlash, escapedSlash.length),
    escapedSlash.length,
  );
  const complete = '{"content":"hi\\u0041';
  assert.equal(
    jsonTextRevealBoundary(complete, complete.length),
    complete.length,
  );
});

test("reveal boundaries preserve raw surrogate pairs and escaped backslashes", () => {
  const text = '{"content":"😀';
  assert.equal(jsonTextRevealBoundary(text, text.length - 1), text.length);
  const partial = text.slice(0, -1);
  assert.equal(
    jsonTextRevealBoundary(partial, partial.length),
    partial.length - 1,
  );
  const literal = '{"content":"\\\\u12';
  assert.equal(jsonTextRevealBoundary(literal, literal.length), literal.length);
});

test("paced drafts hide final arguments until the prefix reveal settles", () => {
  const block = {
    ...draft('{"content":"abc"}'),
    args: { content: "abc" },
    done: true,
  };
  const paced = pacedDraftBlock(block, block.argsText, 14, false);
  assert.equal(paced.argsText, '{"content":"ab');
  assert.equal(paced.args, undefined);
  assert.equal(paced.done, false);
  assert.equal(
    pacedDraftBlock(block, block.argsText, block.argsText.length, true),
    block,
  );
});

test("durable handoff retains a disappearing live slot until its reveal drains", () => {
  const handoff = new ToolArgumentHandoff();
  const block = draft('{"content":"hel');
  const live = handoff.update(block, false);
  assert.equal(live.done, false);
  const final = handoff.update(undefined, true, { content: "hello" });
  assert.equal(final.block, block);
  assert.equal(final.text, '{"content":"hello"}');
  assert.equal(final.done, true);
  const paced = pacedDraftBlock(
    final.block!,
    final.text,
    live.text.length,
    false,
  );
  assert.equal(paced.argsText, live.text);
  assert.equal(paced.done, false);
});

test("handoff never substitutes a bounded or differently serialized final preview", () => {
  const handoff = new ToolArgumentHandoff();
  const text = '{"path": "file", "content": "long partial';
  handoff.update(draft(text), false);
  assert.equal(
    handoff.update(undefined, true, { path: "file", content: "long…" }).text,
    text,
  );
  const remount = new ToolArgumentHandoff().update(undefined, true, {
    content: "done",
  });
  assert.equal(remount.text, "");
  assert.equal(remount.block, undefined);
});
