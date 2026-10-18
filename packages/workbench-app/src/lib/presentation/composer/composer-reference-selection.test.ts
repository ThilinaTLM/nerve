import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ComposerReferenceSelection,
  type ReferenceSelectionScope,
} from "./composer-reference-selection.js";

const scope = (): ReferenceSelectionScope => ({
  document: {},
  source: {},
  query: "@session",
  at: 8,
});
const items = [
  { id: "skill", eligible: true },
  { id: "file", eligible: true },
];

void test("initial/default choice stays best0; explicit entity survives repeated same-query metadata refresh/reordering", () => {
  const selection = new ComposerReferenceSelection(),
    key = scope();
  assert.equal(selection.resolve(key, items), 0);
  selection.prepareRefresh(key, items[1]);
  assert.equal(
    selection.resolve(key, items),
    0,
    "an automatic/default row is not an explicit choice",
  );
  selection.remember(key, items[1]);
  selection.prepareRefresh(key, items[1]);
  selection.prepareRefresh({ ...key }); // repeated notice while the new list is pending
  const refreshed = [
    { id: "new", eligible: true },
    ...items.map((item) => ({ ...item })),
  ];
  assert.equal(
    selection.resolve({ ...key }, refreshed),
    2,
    "stable identity, not previous index or option object",
  );
  selection.prepareRefresh(key, refreshed[2]);
  assert.equal(
    selection.resolve(key, items),
    1,
    "subsequent refresh still honors the explicit entity",
  );
});

void test("deleted/ineligible entity and ordinary close do not preserve an explicit row", () => {
  for (const replacement of [
    [items[0]!],
    [items[0]!, { id: "file", eligible: false }],
  ]) {
    const selection = new ComposerReferenceSelection(),
      key = scope();
    selection.remember(key, items[1]);
    selection.prepareRefresh(key, items[1]);
    assert.equal(selection.resolve(key, replacement), 0);
  }
  const selection = new ComposerReferenceSelection(),
    key = scope();
  selection.remember(key, items[1]);
  selection.prepareRefresh(key, items[1]);
  selection.clear();
  assert.equal(selection.resolve(key, items), 0);
});

void test("new document/source/query/cursor token defaults best0 despite a pending same-query restoration", () => {
  const key = scope();
  for (const changed of [
    { ...key, document: {} },
    { ...key, source: {} },
    { ...key, query: "@other" },
    { ...key, at: 32 },
  ]) {
    const selection = new ComposerReferenceSelection();
    selection.remember(key, items[1]);
    selection.prepareRefresh(key, items[1]);
    assert.equal(selection.resolve(changed, items), 0);
  }
});
