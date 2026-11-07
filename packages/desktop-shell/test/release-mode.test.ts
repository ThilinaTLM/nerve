import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RELEASE_MODE_ENV, consumeReleaseMode } from "../src/release-mode.ts";

describe("release mode", () => {
  it("is enabled only by the launcher marker and never leaks it", () => {
    const env: NodeJS.ProcessEnv = { [RELEASE_MODE_ENV]: "1", PATH: "/bin" };
    assert.equal(consumeReleaseMode(env), true);
    assert.deepEqual(env, { PATH: "/bin" });
    assert.equal(consumeReleaseMode(env), false);
    assert.equal(consumeReleaseMode({ [RELEASE_MODE_ENV]: "0" }), false);
  });
});
