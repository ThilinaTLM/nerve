import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveHeaderType } from "./header-type";

describe("resolveHeaderType", () => {
  it("maps Electron platforms in auto mode", () => {
    assert.equal(resolveHeaderType("auto", "darwin"), "macos");
    assert.equal(resolveHeaderType("auto", "win32"), "windows");
    assert.equal(resolveHeaderType("auto", "linux"), "linux");
  });

  it("uses Linux as the neutral fallback", () => {
    assert.equal(resolveHeaderType("auto"), "linux");
    assert.equal(resolveHeaderType("auto", "freebsd"), "linux");
  });

  it("honors explicit overrides", () => {
    assert.equal(resolveHeaderType("macos", "linux"), "macos");
    assert.equal(resolveHeaderType("windows", "darwin"), "windows");
    assert.equal(resolveHeaderType("linux", "win32"), "linux");
  });
});
