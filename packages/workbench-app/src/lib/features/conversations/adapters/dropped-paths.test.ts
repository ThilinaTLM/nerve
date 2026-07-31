import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatDroppedPathMention, resolveDroppedPaths } from "./dropped-paths";

function droppedItem(name: string): File {
  return { name } as File;
}

describe("resolveDroppedPaths", () => {
  it("preserves order and makes POSIX project paths relative", () => {
    const files = [droppedItem("first.png"), droppedItem("folder")];
    const paths = new Map<File, string>([
      [files[0], "/home/me/project/assets/first.png"],
      [files[1], "/home/me/project/docs"],
    ]);

    assert.deepEqual(
      resolveDroppedPaths(
        files,
        "/home/me/project",
        (file) => paths.get(file)!,
      ),
      ["assets/first.png", "docs"],
    );
  });

  it("handles Windows project paths and keeps outside paths absolute", () => {
    const files = [droppedItem("inside.txt"), droppedItem("outside.txt")];
    const paths = new Map<File, string>([
      [files[0], "C:\\Users\\me\\project\\src\\inside.txt"],
      [files[1], "D:\\Reference\\outside.txt"],
    ]);

    assert.deepEqual(
      resolveDroppedPaths(
        files,
        "C:\\Users\\me\\project",
        (file) => paths.get(file)!,
      ),
      ["src/inside.txt", "D:/Reference/outside.txt"],
    );
  });

  it("quotes path mentions containing whitespace", () => {
    assert.equal(
      formatDroppedPathMention("assets/reference image.png"),
      '"assets/reference image.png"',
    );
    assert.equal(
      formatDroppedPathMention("assets/image.png"),
      "assets/image.png",
    );
    assert.equal(
      formatDroppedPathMention('assets/a "quoted" image.png'),
      '"assets/a \\"quoted\\" image.png"',
    );
  });

  it("represents the project root as a dot", () => {
    const root = droppedItem("project");
    assert.deepEqual(
      resolveDroppedPaths([root], "/home/me/project", () => "/home/me/project"),
      ["."],
    );
  });

  it("fails the whole drop when Electron cannot resolve an item", () => {
    const files = [droppedItem("known.txt"), droppedItem("folder")];
    assert.throws(
      () =>
        resolveDroppedPaths(files, "/home/me/project", (file) =>
          file === files[0] ? "/home/me/project/known.txt" : "",
        ),
      /Could not resolve the native path for folder/,
    );
  });

  it("returns no paths for an empty drop", () => {
    assert.deepEqual(
      resolveDroppedPaths([], "/project", () => "/unused"),
      [],
    );
  });
});
