import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FilesystemProjectEntry } from "@nervekit/contracts";
import {
  absoluteProjectPath,
  buildFileExplorerMenu,
  type FileExplorerMenuActions,
  type FileExplorerMenuIcons,
} from "./file-explorer-menu";

const icons = {
  open: {},
  copy: {},
  openDefault: {},
  newFile: {},
  reveal: {},
  newFolder: {},
  trash: {},
} as FileExplorerMenuIcons;

const actions: FileExplorerMenuActions = {
  open() {},
  createFile() {},
  createFolder() {},
  openDefault() {},
  reveal() {},
  copyPath() {},
  copyRelativePath() {},
  trash() {},
};

function labels(entry: FilesystemProjectEntry, native: boolean): string[] {
  return buildFileExplorerMenu(entry, actions, native, icons).flatMap((item) =>
    "label" in item ? [item.label] : [],
  );
}

describe("file explorer menus", () => {
  it("adds creation only for folders and native actions only on desktop", () => {
    const file: FilesystemProjectEntry = {
      name: "index.ts",
      path: "src/index.ts",
      kind: "file",
      symlink: false,
    };
    const directory: FilesystemProjectEntry = {
      name: "src",
      path: "src",
      kind: "directory",
      symlink: false,
    };
    assert.deepEqual(labels(file, false), [
      "Open",
      "Copy Path",
      "Copy Relative Path",
    ]);
    assert.ok(labels(directory, false).includes("New File"));
    assert.ok(labels(directory, true).includes("Open in Default Application"));
    assert.ok(labels(directory, true).includes("Move to Trash"));
  });

  it("constructs platform display paths without duplicate separators", () => {
    assert.equal(
      absoluteProjectPath("/workspace/project/", "src/index.ts", "linux"),
      "/workspace/project/src/index.ts",
    );
    assert.equal(
      absoluteProjectPath("C:\\workspace\\project\\", "src/index.ts", "win32"),
      "C:\\workspace\\project\\src\\index.ts",
    );
    assert.equal(absoluteProjectPath("/", "etc.txt", "linux"), "/etc.txt");
  });
});
