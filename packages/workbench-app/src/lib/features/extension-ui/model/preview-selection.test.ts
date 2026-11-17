import assert from "node:assert/strict";
import test from "node:test";
import {
  fileExtensionOf,
  matchingPreviews,
  previewKey,
  selectPreview,
  type ExtensionPreview,
} from "./preview-selection";

const preview = (
  extensionId: string,
  id: string,
  extensions: string[],
): ExtensionPreview => ({
  extensionId,
  extensionName: extensionId,
  source: "user",
  id,
  label: id,
  frameUrl: "/x",
  match: { extensions },
  edit: "none",
});

const grid = preview("table", "grid", [".csv", ".tsv"]);
const archive = preview("zip", "list", [".tar.gz"]);

test("matches by file name suffix, case-insensitively", () => {
  assert.deepEqual(matchingPreviews([grid, archive], "/p/Data.CSV"), [grid]);
  assert.deepEqual(matchingPreviews([grid, archive], "a/b.tar.gz"), [archive]);
  assert.deepEqual(
    matchingPreviews([grid], ".csv"),
    [],
    "a dotfile is not an extension",
  );
  assert.deepEqual(matchingPreviews([grid], "notes.txt"), []);
  assert.equal(fileExtensionOf("a/b.tar.GZ"), ".gz");
  assert.equal(fileExtensionOf("Makefile"), "");
});

test("a tab's choice beats the remembered one; stale choices fall back to default", () => {
  const matches = [grid, preview("chart", "plot", [".csv"])];
  const key = previewKey(grid);
  assert.equal(selectPreview({ matches, remembered: key }), grid);
  assert.equal(
    selectPreview({ matches, remembered: key, tabChoice: "default" }),
    undefined,
  );
  assert.equal(
    selectPreview({ matches, remembered: "default", tabChoice: "chart/plot" })
      ?.id,
    "plot",
  );
  assert.equal(selectPreview({ matches, remembered: "gone/thing" }), undefined);
  assert.equal(selectPreview({ matches }), undefined);
});
