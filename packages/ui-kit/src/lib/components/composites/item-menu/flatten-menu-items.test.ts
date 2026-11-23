import assert from "node:assert/strict";
import { test } from "node:test";
import { flattenMenuItems } from "./flatten-menu-items.js";

void test("flattens submenus, drops separators and labels, inherits disabled", () => {
  const open = () => {};
  const flat = flattenMenuItems([
    { type: "label", label: "File" },
    { label: "Open", onSelect: open },
    { type: "separator" },
    {
      type: "submenu",
      label: "Move to",
      disabled: true,
      items: [{ label: "Archive" }],
    },
    { label: "Delete", destructive: true },
  ]);
  assert.deepEqual(flat, [
    { label: "Open", disabled: false, destructive: false, onSelect: open },
    { label: "Move to › Archive", disabled: true, destructive: false },
    { label: "Delete", disabled: false, destructive: true },
  ]);
});
