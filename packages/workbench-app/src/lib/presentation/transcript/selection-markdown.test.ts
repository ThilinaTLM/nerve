import assert from "node:assert/strict";
import { test } from "node:test";

import {
  type MarkdownNode,
  nodeToMarkdown,
  type SelectionClip,
  trimBlankLines,
} from "./selection-markdown.js";

type FakeNode = MarkdownNode & {
  childNodes: FakeNode[];
  parentNode: FakeNode | null;
};

function text(value: string): FakeNode {
  return {
    nodeType: 3,
    nodeName: "#text",
    childNodes: [],
    parentNode: null,
    textContent: value,
  };
}

function el(
  name: string,
  first?: Record<string, string> | FakeNode | string,
  ...rest: Array<FakeNode | string>
): FakeNode {
  const hasAttrs = typeof first === "object" && !("nodeType" in first);
  const attributes = hasAttrs ? (first as Record<string, string>) : {};
  const kids =
    hasAttrs || first === undefined
      ? rest
      : [first as FakeNode | string, ...rest];
  const node: FakeNode = {
    nodeType: 1,
    nodeName: name.toUpperCase(),
    childNodes: [],
    parentNode: null,
    textContent: null,
    getAttribute: (key) => attributes[key] ?? null,
  };
  for (const kid of kids) {
    const child = typeof kid === "string" ? text(kid) : kid;
    child.parentNode = node;
    node.childNodes.push(child);
  }
  return node;
}

const everything: SelectionClip = {
  textOf: (node) => node.textContent ?? "",
  includes: () => true,
};

/** Select from `start` (inclusive) through `end` in document order. */
function between(root: FakeNode, start: FakeNode, end: FakeNode) {
  const order: FakeNode[] = [];
  const walk = (node: FakeNode) => {
    order.push(node);
    node.childNodes.forEach(walk);
  };
  walk(root);
  const from = order.indexOf(start);
  const to = order.indexOf(end);
  const selected = new Set(order.slice(from, to + 1));
  const within = (node: FakeNode): boolean =>
    selected.has(node) || node.childNodes.some(within);
  return {
    textOf: (node) =>
      selected.has(node as FakeNode) ? (node.textContent ?? "") : "",
    includes: (node) => within(node as FakeNode),
  } satisfies SelectionClip;
}

test("preserves lists, emphasis, and inline code", () => {
  const root = el(
    "div",
    "\n",
    el("p", el("strong", "The fix:"), " use ", el("code", "slice"), "."),
    "\n",
    el(
      "ol",
      "\n",
      el("li", "First"),
      "\n",
      el("li", "Second", el("ul", el("li", "Nested"))),
      "\n",
    ),
    "\n",
  );

  assert.equal(
    nodeToMarkdown(root, everything),
    "**The fix:** use `slice`.\n\n1. First\n2. Second\n   - Nested",
  );
});

test("keeps the original ordinal when the selection starts mid-list", () => {
  const second = text("Second");
  const third = text("Third");
  const list = el(
    "ol",
    { start: "3" },
    el("li", "First"),
    el("li", second),
    el("li", third),
  );

  assert.equal(
    nodeToMarkdown(list, between(list, second, third)),
    "4. Second\n5. Third",
  );
});

test("fences code blocks and skips copy buttons", () => {
  const root = el(
    "div",
    el(
      "div",
      { class: "code-block" },
      el("span", { class: "code-copy" }, "Copy"),
      el("pre", el("code", { class: "language-ts" }, "const a = 1;\n")),
    ),
  );

  assert.equal(nodeToMarkdown(root, everything), "```ts\nconst a = 1;\n```");
});

test("renders tables with a header separator", () => {
  const table = el(
    "table",
    el("thead", el("tr", el("th", "A"), el("th", "B"))),
    el("tbody", el("tr", el("td", "1"), el("td", "2"))),
  );

  assert.equal(
    nodeToMarkdown(table, everything),
    "| A | B |\n| --- | --- |\n| 1 | 2 |",
  );
});

test("trimBlankLines drops trailing empty lines from plain selections", () => {
  assert.equal(trimBlankLines("\nHello\n\n world  \n\n\n"), "Hello\n\n world");
});
