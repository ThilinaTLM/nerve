import assert from "node:assert/strict";
import { test } from "node:test";
import {
  anchorInApp,
  menuIconNames,
  menuItemsOf,
  pickRowsOf,
} from "./host-overlay";

const frame = { left: 100, top: 50, width: 300, height: 200 };

test("an anchor lands at the frame's offset and is kept inside the frame", () => {
  const rect = anchorInApp(frame, { x: 10, y: 20, width: 40, height: 8 });
  assert.deepEqual(
    [rect.left, rect.top, rect.width, rect.height],
    [110, 70, 40, 8],
  );
  const outside = anchorInApp(frame, { x: -50, y: 999, width: 500, height: 5 });
  assert.deepEqual(
    [outside.left, outside.top, outside.width, outside.height],
    [100, 250, 300, 0],
  );
  const centered = anchorInApp(frame, undefined);
  assert.deepEqual(
    [centered.left, centered.top, centered.width],
    [250, 150, 0],
  );
});

test("a menu is headed by the extension's name and keeps the whole tree", () => {
  const chosen: string[] = [];
  const entries = [
    { id: "a", label: "A", icon: "copy", checked: true, shortcut: "Ctrl+A" },
    { type: "separator" as const },
    {
      type: "submenu" as const,
      label: "More",
      icon: "no-such-icon",
      items: [{ id: "b", label: "B", destructive: true, disabled: true }],
    },
  ];
  assert.deepEqual(menuIconNames(entries).sort(), ["copy", "no-such-icon"]);
  const copy = (() => null) as never;
  const items = menuItemsOf(entries, {
    extensionName: "Notes",
    icons: new Map([["copy", copy]]),
    onChoose: (id) => chosen.push(id),
  });
  assert.deepEqual(items[0], { type: "label", label: "From Notes" });
  assert.deepEqual(items[1], { type: "separator" });
  const first = items[2];
  assert.ok(
    first &&
      first.type !== "separator" &&
      first.type !== "label" &&
      first.type !== "submenu",
  );
  assert.equal(first.icon, copy);
  assert.equal(first.checked, true);
  first.onSelect?.();
  assert.deepEqual(chosen, ["a"]);
  const submenu = items[4];
  assert.ok(submenu?.type === "submenu");
  // An icon the host does not know draws nothing.
  assert.equal("icon" in submenu, false);
  const nested = submenu.items[0];
  assert.ok(
    nested &&
      nested.type !== "separator" &&
      nested.type !== "label" &&
      nested.type !== "submenu",
  );
  assert.equal(nested.destructive, true);
  assert.equal(nested.disabled, true);
});

test("pick rows keep search terms and list ungrouped items under no heading", () => {
  const rows = pickRowsOf([
    {
      id: "a",
      label: "A",
      group: "G",
      keywords: ["x"],
      detail: "d",
      icon: "star",
    },
    { id: "b", label: "B", disabled: true },
  ]);
  assert.deepEqual(rows[0], {
    key: "a",
    label: "A",
    group: "G",
    keywords: ["x"],
    detail: "d",
    icon: "star",
    disabled: false,
  });
  assert.deepEqual(rows[1], {
    key: "b",
    label: "B",
    group: "",
    disabled: true,
  });
});
