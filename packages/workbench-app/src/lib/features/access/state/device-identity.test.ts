import assert from "node:assert/strict";
import test from "node:test";
import { defaultDeviceName, deviceKindFor } from "./device-identity";

const PIXEL =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36";
const MAC_SAFARI =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const EDGE =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36 Edg/126.0";

test("suggests a readable name from the user agent", () => {
  assert.equal(defaultDeviceName(PIXEL), "Chrome on Android");
  assert.equal(defaultDeviceName(MAC_SAFARI), "Safari on macOS");
  assert.equal(defaultDeviceName(EDGE), "Edge on Windows");
  assert.equal(defaultDeviceName(""), "Browser");
});

test("classifies phones", () => {
  assert.equal(deviceKindFor(PIXEL), "mobile");
  assert.equal(deviceKindFor(MAC_SAFARI), "browser");
});
