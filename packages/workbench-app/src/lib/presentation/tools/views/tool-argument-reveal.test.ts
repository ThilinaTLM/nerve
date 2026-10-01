import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ConversationLiveToolDraftBlockSnapshot } from "@nervekit/contracts/conversations";
import {
  jsonTextRevealBoundary,
  pacedDraftBlock,
} from "./tool-argument-reveal.js";

describe("jsonTextRevealBoundary", () => {
  it("keeps whole and empty lengths", () => {
    assert.equal(jsonTextRevealBoundary('{"a":"b"}', 0), 0);
    assert.equal(jsonTextRevealBoundary('{"a":"b"}', 9), 9);
    assert.equal(jsonTextRevealBoundary('{"a":"b"}', 50), 9);
  });

  it("never ends on a dangling escape backslash", () => {
    const text = '{"c":"a\\nb"}';
    const slash = text.indexOf("\\");
    assert.equal(jsonTextRevealBoundary(text, slash + 1), slash);
    assert.equal(jsonTextRevealBoundary(text, slash + 2), slash + 2);
  });

  it("allows an escaped backslash pair", () => {
    const text = '{"c":"a\\\\b"}';
    const slash = text.indexOf("\\");
    assert.equal(jsonTextRevealBoundary(text, slash + 2), slash + 2);
    assert.equal(jsonTextRevealBoundary(text, slash + 1), slash);
  });

  it("waits for all four unicode escape digits", () => {
    const text = '{"c":"x\\u00e9y"}';
    const slash = text.indexOf("\\");
    for (let length = slash + 1; length < slash + 6; length += 1) {
      assert.equal(jsonTextRevealBoundary(text, length), slash);
    }
    assert.equal(jsonTextRevealBoundary(text, slash + 6), slash + 6);
  });

  it("does not treat an escaped backslash followed by u as unicode", () => {
    const text = '{"c":"\\\\u00"}';
    const end = text.indexOf("u") + 2;
    assert.equal(jsonTextRevealBoundary(text, end), end);
  });

  it("never splits a surrogate pair", () => {
    const text = '{"c":"😀"}';
    const high = text.indexOf("😀");
    assert.equal(jsonTextRevealBoundary(text, high + 1), high + 2);
  });
});

describe("pacedDraftBlock", () => {
  const block: ConversationLiveToolDraftBlockSnapshot = {
    kind: "tool_call_draft",
    contentBlockId: "b1",
    contentIndex: 0,
    toolName: "write",
    argsText: "",
    args: { path: "a.ts", content: "hello" },
    progress: {
      lineCount: 1,
    } as ConversationLiveToolDraftBlockSnapshot["progress"],
    progressRevision: 1,
    done: true,
  };
  const argsText = '{"path":"a.ts","content":"hello"}';

  it("projects the revealed prefix as an open draft while unsettled", () => {
    const paced = pacedDraftBlock(block, argsText, 20, false);
    assert.equal(paced.argsText, argsText.slice(0, 20));
    assert.equal(paced.args, undefined);
    assert.equal(paced.progress, undefined);
    assert.equal(paced.done, false);
  });

  it("passes the exact final block through once settled", () => {
    assert.equal(
      pacedDraftBlock(block, argsText, argsText.length, true),
      block,
    );
  });

  it("passes blocks without streamed text through", () => {
    assert.equal(pacedDraftBlock(block, "", 0, false), block);
  });
});
