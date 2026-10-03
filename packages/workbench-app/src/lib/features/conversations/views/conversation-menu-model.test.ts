import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ContextMenuItem } from "@nervekit/ui-kit/components/composites/context-menu-list";
import type { TranscriptMenuTarget } from "$lib/presentation/conversations";
import { transcriptMenuModel } from "./conversation-menu-model";

function menuFor(target: TranscriptMenuTarget, selection?: string) {
  const quotes: string[] = [];
  const copies: string[] = [];
  const items = transcriptMenuModel(target, selection, {
    treeEntriesById: new Map(),
    quoteInComposer: (text) => {
      quotes.push(text);
    },
    copyText: (text) => {
      copies.push(text);
    },
  });
  return { items, quotes, copies };
}

function select(items: ContextMenuItem[], label: string) {
  const item = items.find(
    (item) =>
      (item.type === undefined || item.type === "item") && item.label === label,
  );
  assert.ok(item && (item.type === undefined || item.type === "item"));
  assert.ok(!item.disabled);
  assert.ok(item.onSelect);
  item.onSelect();
}

describe("transcript menu quoting", () => {
  for (const kind of ["message", "thinking"] as const) {
    const target = {
      kind,
      item: {
        id: "message_1",
        role: "assistant",
        text: "The full message\nwith more content.",
      },
    } satisfies TranscriptMenuTarget;

    it(`quotes the selected passage from a ${kind}`, () => {
      const { items, quotes } = menuFor(target, "selected passage");
      select(items, "Quote selection");
      assert.deepEqual(quotes, ["selected passage"]);
    });

    it(`preserves multiline selection and whitespace from a ${kind}`, () => {
      const selection = "  first line\nsecond line\n ";
      const { items, quotes } = menuFor(target, selection);
      select(items, "Quote selection");
      assert.deepEqual(quotes, [selection]);
    });

    for (const selection of [undefined, "", " \n\t"]) {
      it(`quotes the full ${kind} with ${JSON.stringify(selection)} selection`, () => {
        const { items, quotes } = menuFor(target, selection);
        select(items, "Quote");
        assert.deepEqual(quotes, [target.item.text]);
      });
    }

    it(`keeps full-content and selection copying distinct for a ${kind}`, () => {
      const { items, copies } = menuFor(target, "selected passage");
      select(items, "Copy content");
      select(items, "Copy selection");
      assert.deepEqual(copies, [target.item.text, "selected passage"]);
    });
  }

  it("does not add Quote to a non-quotable target with a selection", () => {
    const { items } = menuFor(
      { kind: "tool_result_error", toolName: "bash", error: "Command failed" },
      "Command",
    );
    assert.equal(
      items.some(
        (item) =>
          "label" in item &&
          (item.label === "Quote" || item.label === "Quote selection"),
      ),
      false,
    );
  });
});
