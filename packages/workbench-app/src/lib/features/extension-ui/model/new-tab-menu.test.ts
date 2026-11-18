import assert from "node:assert/strict";
import test from "node:test";
import { newTabMenuGroups } from "./new-tab-menu";

const page = (extensionId: string, id: string, newMenu = true) => ({
  extensionId,
  extensionName: `Ext ${extensionId}`,
  source: "user" as const,
  id,
  label: id,
  frameUrl: "/x",
  icon: "table",
  newMenu,
});

test("no pages yields no groups, so no chevron", () => {
  assert.deepEqual(newTabMenuGroups([]), []);
});

test("pages with newMenu=false are left out", () => {
  assert.deepEqual(newTabMenuGroups([page("a", "one", false)]), []);
  const groups = newTabMenuGroups([page("a", "one"), page("a", "two", false)]);
  assert.deepEqual(
    groups[0]?.pages.map((p) => p.id),
    ["one"],
  );
});

test("a single extension has no heading", () => {
  const groups = newTabMenuGroups([page("a", "one"), page("a", "two")]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.heading, undefined);
});

test("several extensions are grouped under their names", () => {
  const groups = newTabMenuGroups([
    page("a", "one"),
    page("b", "x"),
    page("a", "two"),
  ]);
  assert.deepEqual(
    groups.map((g) => [g.heading, g.pages.map((p) => p.id)]),
    [
      ["Ext a", ["one", "two"]],
      ["Ext b", ["x"]],
    ],
  );
});
