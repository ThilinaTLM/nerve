import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SPLASH_ELAPSED_PARAM,
  withSplashElapsed,
} from "../src/window/splash-handoff.js";

describe("withSplashElapsed", () => {
  it("hands the elapsed intro time over without replacing existing parameters", () => {
    const result = new URL(
      withSplashElapsed(
        "http://127.0.0.1:3747/?token=local&nerveInitialZoomLevel=1",
        1180.6,
      ),
    );
    assert.equal(result.searchParams.get("token"), "local");
    assert.equal(result.searchParams.get("nerveInitialZoomLevel"), "1");
    assert.equal(result.searchParams.get(SPLASH_ELAPSED_PARAM), "1181");
  });

  it("clamps long startups so the workbench simply renders the settled splash", () => {
    const result = new URL(
      withSplashElapsed("http://127.0.0.1:3747/", 120_000),
    );
    assert.equal(result.searchParams.get(SPLASH_ELAPSED_PARAM), "10000");
  });

  it("leaves the url untouched for unusable values", () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, -5])
      assert.equal(
        withSplashElapsed("http://127.0.0.1:3747/", value),
        "http://127.0.0.1:3747/",
      );
  });
});
