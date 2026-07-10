import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  looksLikePath,
  pathBreadcrumbs,
  pathKey,
  samePath,
  tildePath,
} from "./path";

describe("looksLikePath", () => {
  it("detects POSIX, ~, and slash inputs", () => {
    assert.equal(looksLikePath("/home/me/x"), true);
    assert.equal(looksLikePath("~/projects"), true);
    assert.equal(looksLikePath("a/b"), true);
    assert.equal(looksLikePath("project"), false);
    assert.equal(looksLikePath("  "), false);
  });

  it("detects Windows drive, UNC, backslash, and file:// inputs", () => {
    assert.equal(looksLikePath("C:\\Users\\me"), true);
    assert.equal(looksLikePath("C:/Users/me"), true);
    assert.equal(looksLikePath("C:"), true);
    assert.equal(looksLikePath("\\\\server\\share"), true);
    assert.equal(looksLikePath("src\\file"), true);
    assert.equal(looksLikePath("file:///home/me"), true);
    assert.equal(looksLikePath("TODO: clean up"), false);
  });
});

describe("pathKey / samePath", () => {
  it("keeps POSIX paths case-sensitive", () => {
    assert.notEqual(pathKey("/home/Me/Proj"), pathKey("/home/me/proj"));
    assert.equal(samePath("/home/me/proj/", "/home/me/proj"), true);
    assert.equal(samePath("/home/me/a", "/home/me/b"), false);
  });

  it("treats Windows drive paths case-insensitively", () => {
    assert.equal(pathKey("C:\\Users\\Me"), pathKey("c:/users/me"));
    assert.equal(samePath("C:\\Users\\Me\\", "c:/users/me"), true);
  });
});

describe("pathBreadcrumbs", () => {
  it("builds POSIX crumbs from root", () => {
    assert.deepEqual(pathBreadcrumbs("/home/me/proj"), [
      { label: "/", path: "/" },
      { label: "home", path: "/home" },
      { label: "me", path: "/home/me" },
      { label: "proj", path: "/home/me/proj" },
    ]);
  });

  it("collapses the home prefix to ~", () => {
    assert.deepEqual(pathBreadcrumbs("/home/me/proj/app", "/home/me"), [
      { label: "~", path: "/home/me" },
      { label: "proj", path: "/home/me/proj" },
      { label: "app", path: "/home/me/proj/app" },
    ]);
  });

  it("builds Windows drive crumbs preserving backslashes", () => {
    assert.deepEqual(pathBreadcrumbs("C:\\Users\\me\\proj"), [
      { label: "C:", path: "C:\\" },
      { label: "Users", path: "C:\\Users" },
      { label: "me", path: "C:\\Users\\me" },
      { label: "proj", path: "C:\\Users\\me\\proj" },
    ]);
  });

  it("collapses home on Windows case-insensitively", () => {
    assert.deepEqual(pathBreadcrumbs("C:\\Users\\Me\\proj", "c:\\users\\me"), [
      { label: "~", path: "c:\\users\\me" },
      { label: "proj", path: "c:\\users\\me\\proj" },
    ]);
  });

  it("builds UNC crumbs from the share root", () => {
    assert.deepEqual(pathBreadcrumbs("\\\\server\\share\\proj"), [
      { label: "\\\\server\\share", path: "\\\\server\\share" },
      { label: "proj", path: "\\\\server\\share\\proj" },
    ]);
  });

  it("keeps tildePath consistent with breadcrumb home collapse", () => {
    assert.equal(tildePath("/home/me/proj", "/home/me"), "~/proj");
  });
});
