import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FilesystemProjectEntry } from "@nervekit/contracts";
import {
  absoluteProjectPath,
  buildFileExplorerMenu,
  buildProjectRootMenu,
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

function labels(
  entry: FilesystemProjectEntry,
  native: boolean,
  launchItems: ReturnType<typeof buildFileExplorerMenu> = [],
): string[] {
  return buildFileExplorerMenu(
    entry,
    actions,
    native,
    icons,
    launchItems,
  ).flatMap((item) => ("label" in item ? [item.label] : []));
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
      "Copy path",
      "Copy relative path",
    ]);
    assert.ok(labels(directory, false).includes("New file"));
    assert.ok(labels(directory, true).includes("Open with default app"));
    assert.ok(labels(directory, true).includes("Move to trash"));
  });

  it("inserts target-appropriate external launch groups", () => {
    const editors = [
      { label: "Open in VS Code", onSelect() {} },
      { label: "Open in Zed", onSelect() {} },
    ];
    const terminal = { label: "Open in Terminal", onSelect() {} };
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
    assert.ok(labels(file, false, editors).includes("Open in VS Code"));
    assert.ok(
      labels(directory, false, [...editors, terminal]).includes(
        "Open in Terminal",
      ),
    );
  });

  it("offers root operations without destructive or relative-path actions", () => {
    const rootLabels = buildProjectRootMenu(actions, true, icons, [
      { label: "Open in VS Code", onSelect() {} },
      { label: "Open in Terminal", onSelect() {} },
    ]).flatMap((item) => ("label" in item ? [item.label] : []));
    assert.deepEqual(rootLabels, [
      "New file",
      "New folder",
      "Open in VS Code",
      "Open in Terminal",
      "Open with default app",
      "Show in file manager",
      "Copy path",
    ]);
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
