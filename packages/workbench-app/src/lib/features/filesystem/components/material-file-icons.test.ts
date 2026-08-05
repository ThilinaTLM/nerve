import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveMaterialFileIcon,
  type MaterialFileIconData,
} from "./material-file-icon-resolver";

const data: MaterialFileIconData = {
  file: "file",
  folder: "folder",
  folderExpanded: "folder-open",
  fileNames: { "package.json": "node" },
  fileExtensions: { ts: "typescript", "d.ts": "typescript-def" },
  folderNames: { src: "folder-src" },
  folderNamesExpanded: { src: "folder-src-open" },
  urls: {
    file: "/file.svg",
    folder: "/folder.svg",
    "folder-open": "/folder-open.svg",
    node: "/node.svg",
    typescript: "/ts.svg",
    "typescript-def": "/dts.svg",
    "folder-src": "/src.svg",
    "folder-src-open": "/src-open.svg",
  },
};

describe("Material file icon resolution", () => {
  it("prefers exact names and compound extensions case-insensitively", () => {
    assert.equal(
      resolveMaterialFileIcon(data, { name: "PACKAGE.JSON", kind: "file" }),
      "/node.svg",
    );
    assert.equal(
      resolveMaterialFileIcon(data, { name: "types.D.TS", kind: "file" }),
      "/dts.svg",
    );
  });

  it("uses named open folders and stable fallbacks", () => {
    assert.equal(
      resolveMaterialFileIcon(data, {
        name: "SRC",
        kind: "directory",
        open: true,
      }),
      "/src-open.svg",
    );
    assert.equal(
      resolveMaterialFileIcon(data, { name: "unknown", kind: "file" }),
      "/file.svg",
    );
    assert.equal(
      resolveMaterialFileIcon(data, {
        name: "unknown",
        kind: "directory",
        open: true,
      }),
      "/folder-open.svg",
    );
  });
});
