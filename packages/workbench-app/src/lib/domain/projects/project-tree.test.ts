import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shortProjectLabel } from "./project-tree";

describe("shortProjectLabel", () => {
  it("collapses home and abbreviates parents on POSIX and Windows", () => {
    assert.equal(
      shortProjectLabel("/home/me/Projects/app", "/home/me"),
      "~/P/app",
    );
    assert.equal(
      shortProjectLabel("c:\\Users\\Me\\Projects\\app\\", "C:\\Users\\Me"),
      "~/P/app",
    );
  });

  it("keeps a UNC root whole", () => {
    assert.equal(
      shortProjectLabel("\\\\server\\share\\team\\app"),
      "//server/share/t/app",
    );
  });
});
