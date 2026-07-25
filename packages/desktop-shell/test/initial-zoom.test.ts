import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  INITIAL_ZOOM_LEVEL_PARAM,
  withInitialZoomLevel,
} from "../src/window/initial-zoom.js";

describe("withInitialZoomLevel", () => {
  it("adds the persisted zoom level without replacing existing parameters", () => {
    const result = new URL(
      withInitialZoomLevel("http://127.0.0.1:3747/?token=local", 1),
    );
    assert.equal(result.searchParams.get("token"), "local");
    assert.equal(result.searchParams.get(INITIAL_ZOOM_LEVEL_PARAM), "1");
  });
});
