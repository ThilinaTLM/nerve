import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  appIconAssetSegments,
  trayIconAssetSegments,
} from "../src/window/desktop-asset-names.ts";

describe("desktop asset selection", () => {
  it("uses a Windows ICO for BrowserWindow", () => {
    assert.deepEqual(appIconAssetSegments("win32"), [
      "build",
      "windows",
      "app.ico",
    ]);
  });

  it("uses the Linux PNG app icon outside Windows", () => {
    assert.deepEqual(appIconAssetSegments("linux"), [
      "build",
      "icons",
      "512x512.png",
    ]);
    assert.deepEqual(appIconAssetSegments("darwin"), [
      "build",
      "icons",
      "512x512.png",
    ]);
  });

  it("uses the macOS template image regardless of appearance", () => {
    const expected = ["build", "tray", "macos", "nerveTemplate.png"];
    assert.deepEqual(trayIconAssetSegments("darwin", false), expected);
    assert.deepEqual(trayIconAssetSegments("darwin", true), expected);
  });

  it("selects themed Windows tray ICOs", () => {
    assert.deepEqual(trayIconAssetSegments("win32", false), [
      "build",
      "tray",
      "windows",
      "tray-light.ico",
    ]);
    assert.deepEqual(trayIconAssetSegments("win32", true), [
      "build",
      "tray",
      "windows",
      "tray-dark.ico",
    ]);
  });

  it("selects themed Linux tray PNGs", () => {
    assert.deepEqual(trayIconAssetSegments("linux", false), [
      "build",
      "tray",
      "linux",
      "tray-light.png",
    ]);
    assert.deepEqual(trayIconAssetSegments("linux", true), [
      "build",
      "tray",
      "linux",
      "tray-dark.png",
    ]);
  });
});
