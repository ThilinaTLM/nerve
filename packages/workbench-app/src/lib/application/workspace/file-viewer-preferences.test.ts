import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadFileViewerPreferences } from "./file-viewer-preferences";

function storage(value: string | null): Pick<Storage, "getItem" | "setItem"> {
  return {
    getItem: () => value,
    setItem: () => undefined,
  };
}

describe("file viewer preferences", () => {
  it("disables viewer options by default", () => {
    assert.deepEqual(loadFileViewerPreferences(storage(null)), {
      highlightSelectionMatches: false,
      wrapLongLines: false,
    });
    assert.deepEqual(loadFileViewerPreferences(storage("not-json")), {
      highlightSelectionMatches: false,
      wrapLongLines: false,
    });
  });

  it("restores stored viewer preferences", () => {
    assert.deepEqual(
      loadFileViewerPreferences(
        storage(
          JSON.stringify({
            highlightSelectionMatches: true,
            wrapLongLines: true,
          }),
        ),
      ),
      { highlightSelectionMatches: true, wrapLongLines: true },
    );
  });
});
