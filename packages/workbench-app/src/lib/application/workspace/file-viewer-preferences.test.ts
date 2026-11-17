import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  loadFileViewerPreferences,
  maxExtensionPreviewChoices,
  withExtensionPreviewChoice,
} from "./file-viewer-preferences";

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
      diffLayout: "unified",
      extensionPreviews: {},
    });
    assert.deepEqual(loadFileViewerPreferences(storage("not-json")), {
      highlightSelectionMatches: false,
      wrapLongLines: false,
      diffLayout: "unified",
      extensionPreviews: {},
    });
  });

  it("restores stored viewer preferences", () => {
    assert.deepEqual(
      loadFileViewerPreferences(
        storage(
          JSON.stringify({
            highlightSelectionMatches: true,
            wrapLongLines: true,
            diffLayout: "split",
            extensionPreviews: { ".csv": "table/grid", ".x": 4 },
          }),
        ),
      ),
      {
        highlightSelectionMatches: true,
        wrapLongLines: true,
        diffLayout: "split",
        extensionPreviews: { ".csv": "table/grid" },
      },
    );
  });

  it("remembers the newest choices per file extension", () => {
    let choices: Record<string, string> = {};
    for (let index = 0; index < maxExtensionPreviewChoices + 3; index += 1)
      choices = withExtensionPreviewChoice(choices, `.e${index}`, "default");
    assert.equal(Object.keys(choices).length, maxExtensionPreviewChoices);
    assert.equal(".e0" in choices, false);
    choices = withExtensionPreviewChoice(choices, ".e10", "a/b");
    assert.equal(Object.keys(choices).at(-1), ".e10");
    assert.equal(choices[".e10"], "a/b");
  });
});
