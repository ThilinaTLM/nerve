import assert from "node:assert/strict";
import test from "node:test";
import {
  extensionPageTabId,
  extensionPanelViewId,
  parseExtensionPageTabId,
  parseExtensionPanelViewId,
} from "./page-tab-id";

test("page params distinguish tabs and survive a restore", () => {
  const plain = extensionPageTabId("board", "main");
  assert.equal(plain, "board/main");
  assert.deepEqual(parseExtensionPageTabId(plain), {
    extensionId: "board",
    pageId: "main",
  });
  const a = extensionPageTabId("board", "main", {
    b: 1,
    a: [2, { y: 1, x: 2 }],
  });
  const b = extensionPageTabId("board", "main", {
    a: [2, { x: 2, y: 1 }],
    b: 1,
  });
  assert.equal(a, b, "key order does not matter");
  assert.notEqual(a, plain);
  assert.deepEqual(parseExtensionPageTabId(a), {
    extensionId: "board",
    pageId: "main",
    params: { a: [2, { x: 2, y: 1 }], b: 1 },
  });
});

test("malformed ids are rejected", () => {
  assert.equal(parseExtensionPageTabId("board"), undefined);
  assert.equal(parseExtensionPageTabId("Board/Main"), undefined);
  assert.equal(parseExtensionPageTabId("board/main?%7Bnope"), undefined);
});

test("panel view ids round-trip", () => {
  const id = extensionPanelViewId("board", "queue");
  assert.deepEqual(parseExtensionPanelViewId(id), {
    extensionId: "board",
    panelId: "queue",
  });
  assert.equal(parseExtensionPanelViewId("files"), undefined);
});
