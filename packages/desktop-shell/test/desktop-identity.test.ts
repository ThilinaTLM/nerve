import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DESKTOP_APP_ID,
  DESKTOP_APP_NAME,
  MACOS_TRAY_GUID,
} from "../src/desktop-identity.ts";

describe("desktop identity", () => {
  it("uses one stable packaged application identity", () => {
    assert.equal(DESKTOP_APP_NAME, "Nerve");
    assert.equal(DESKTOP_APP_ID, "io.github.thilinatlm.nerve");
  });

  it("provides a valid stable macOS tray GUID", () => {
    assert.match(
      MACOS_TRAY_GUID,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});
