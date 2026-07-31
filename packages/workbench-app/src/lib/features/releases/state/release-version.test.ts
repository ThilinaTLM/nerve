import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { displayVersion, isVersionOutdated } from "./release-version";

describe("release version comparison", () => {
  it("warns only when the latest version is strictly newer", () => {
    assert.equal(isVersionOutdated("0.15.0", "0.16.0"), true);
    assert.equal(isVersionOutdated("0.15.0", "1.0.0"), true);
    assert.equal(isVersionOutdated("0.15.0", "0.15.1"), true);
    assert.equal(isVersionOutdated("0.15.0", "0.15.0"), false);
    assert.equal(isVersionOutdated("0.16.0", "0.15.0"), false);
  });

  it("accepts v prefixes and ignores build metadata", () => {
    assert.equal(isVersionOutdated("v0.15.0", "v0.16.0"), true);
    assert.equal(isVersionOutdated("0.15.0+local", "0.15.0+release"), false);
    assert.equal(displayVersion("v0.15.0"), "v0.15.0");
    assert.equal(displayVersion("0.15.0"), "v0.15.0");
  });

  it("uses semantic prerelease precedence", () => {
    assert.equal(isVersionOutdated("0.16.0-beta.1", "0.16.0"), true);
    assert.equal(isVersionOutdated("0.16.0-beta.2", "0.16.0-beta.10"), true);
    assert.equal(isVersionOutdated("0.16.0", "0.16.0-beta.1"), false);
    assert.equal(
      isVersionOutdated("0.16.0-beta.alpha", "0.16.0-beta.2"),
      false,
    );
  });

  it("stays neutral when either version is missing or malformed", () => {
    assert.equal(isVersionOutdated(undefined, "0.16.0"), false);
    assert.equal(isVersionOutdated("0.15.0", undefined), false);
    assert.equal(isVersionOutdated("development", "0.16.0"), false);
    assert.equal(isVersionOutdated("0.15", "0.16.0"), false);
  });
});
