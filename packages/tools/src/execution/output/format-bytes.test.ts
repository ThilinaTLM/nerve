import assert from "node:assert/strict";
import test from "node:test";
import { formatByteSize } from "./format-bytes.js";

void test("formatByteSize uses one spaced format across units", () => {
  assert.equal(formatByteSize(0), "0 B");
  assert.equal(formatByteSize(1023), "1023 B");
  assert.equal(formatByteSize(1536), "1.5 KB");
  assert.equal(formatByteSize(21 * 1024 * 1024), "21.0 MB");
});
