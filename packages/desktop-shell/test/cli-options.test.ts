import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseDesktopOptions } from "../src/app/cli-options.js";
import {
  electronOzonePlatformSwitch,
  parseElectronOzonePlatform,
} from "../src/shared/ozone-platform.js";
import { ShellPageUrlRegistry } from "../src/window/loading-pages.js";

describe("desktop CLI options", () => {
  it("rejects local and remote modes in either order", () => {
    assert.throws(
      () => parseDesktopOptions(["--local", "--connect", "https://host"]),
      /either --local or --connect/,
    );
    assert.throws(
      () => parseDesktopOptions(["--connect=https://host", "--local"]),
      /either --local or --connect/,
    );
  });
});

describe("Electron Ozone platform", () => {
  it("treats auto as Chromium's default rather than a literal switch", () => {
    assert.equal(
      electronOzonePlatformSwitch(parseElectronOzonePlatform("auto")),
      undefined,
    );
    assert.equal(
      electronOzonePlatformSwitch(parseElectronOzonePlatform("x11")),
      "x11",
    );
    assert.equal(
      electronOzonePlatformSwitch(parseElectronOzonePlatform("wayland")),
      "wayland",
    );
  });
});

describe("shell page URL registry", () => {
  it("trusts only the current desktop-generated data URL", () => {
    const registry = new ShellPageUrlRegistry();
    const first = registry.create("<p>Loading</p>");
    assert.equal(registry.isTrusted(first), true);
    assert.equal(registry.isTrusted("data:text/html,untrusted"), false);
    const second = registry.create("<p>Error</p>");
    assert.equal(registry.isTrusted(first), false);
    assert.equal(registry.isTrusted(second), true);
    registry.clear();
    assert.equal(registry.isTrusted(second), false);
  });
});
