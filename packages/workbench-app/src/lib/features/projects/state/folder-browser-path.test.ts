import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  completionQuery,
  pathCrumbs,
  parentPath,
  projectRoots,
  resolveTypedPath,
  THIS_PC,
  toDisplayPath,
  type PathContext,
} from "./folder-browser-path";

const linux: PathContext = {
  platform: "linux",
  separator: "/",
  home: "/home/tlm",
  caseInsensitive: false,
};
const win: PathContext = {
  platform: "win32",
  separator: "\\",
  home: "C:\\Users\\tlm",
  caseInsensitive: true,
};

describe("folder browser paths", () => {
  it("expands ~ and normalises Windows separators", () => {
    assert.equal(resolveTypedPath("~/Projects/", linux), "/home/tlm/Projects");
    assert.equal(resolveTypedPath("/", linux), "/");
    assert.equal(
      resolveTypedPath("~\\Projects", win),
      "C:\\Users\\tlm\\Projects",
    );
    assert.equal(resolveTypedPath("D:/work/", win), "D:\\work");
    assert.equal(resolveTypedPath("c:", win), "c:\\");
  });

  it("finds the parent, with This PC above a drive", () => {
    assert.equal(parentPath("/home/tlm", linux), "/home");
    assert.equal(parentPath("/home", linux), "/");
    assert.equal(parentPath("/", linux), undefined);
    assert.equal(parentPath("C:\\Users", win), "C:\\");
    assert.equal(parentPath("C:\\", win), THIS_PC);
    assert.equal(parentPath(THIS_PC, win), undefined);
  });

  it("builds crumbs rooted at ~, the root, or This PC", () => {
    assert.deepEqual(
      pathCrumbs("/home/tlm/Projects", linux).map((crumb) => crumb.label),
      ["~", "Projects"],
    );
    assert.deepEqual(
      pathCrumbs("/etc/ssh", linux, "Macintosh HD").map((c) => c.label),
      ["Macintosh HD", "etc", "ssh"],
    );
    assert.deepEqual(
      pathCrumbs("D:\\Games\\x", win).map((crumb) => crumb.path),
      [THIS_PC, "D:\\", "D:\\Games", "D:\\Games\\x"],
    );
  });

  it("collapses home using the daemon's casing rules", () => {
    assert.equal(toDisplayPath("/home/tlm/a", linux), "~/a");
    assert.equal(toDisplayPath("/home/TLM/a", linux), "/home/TLM/a");
    assert.equal(toDisplayPath("c:\\users\\TLM\\a", win), "~\\a");
  });

  it("splits a half-typed path into folder and prefix", () => {
    assert.deepEqual(completionQuery("~/Pro", linux), {
      dir: "/home/tlm",
      prefix: "Pro",
    });
    assert.deepEqual(completionQuery("/", linux), { dir: "/", prefix: "" });
    assert.deepEqual(completionQuery("C:/Us", win), {
      dir: "C:\\",
      prefix: "Us",
    });
    assert.equal(completionQuery("Pro", linux), undefined);
  });

  it("ranks project roots by how many projects they hold", () => {
    assert.deepEqual(
      projectRoots(
        ["/home/tlm/Projects/a", "/home/tlm/Projects/b", "/srv/c"],
        linux,
      ),
      ["/home/tlm/Projects", "/srv"],
    );
  });
});
