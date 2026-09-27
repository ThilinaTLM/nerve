import assert from "node:assert/strict";
import { test } from "node:test";
import { checksumJsonV1, encodeJsonV1, parseJsonObjectV1 } from "./v1.js";

void test("JSON v1 rejects non-JSON objects, values, cycles, and malformed UTF-8", () => {
  assert.throws(() => parseJsonObjectV1(new Date()), /encoded JSON/);
  assert.throws(() => encodeJsonV1({ value: undefined } as never), /non-JSON/);
  assert.throws(() => encodeJsonV1({ value: Number.NaN }), /non-finite/);
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  assert.throws(() => encodeJsonV1(cyclic as never), /cycle/);
  assert.throws(
    () => parseJsonObjectV1(Uint8Array.from([0x7b, 0xff, 0x7d])),
    /encoded data was not valid for encoding utf-8/,
  );
});

void test("JSON v1 hashes the exact validated UTF-8 encoding", () => {
  const value = parseJsonObjectV1('{"ok":true,"count":2}');
  assert.equal(
    checksumJsonV1(value),
    "sha256:dd374af7e3d00d3e395e4a6a2ff9359f7f02af33e45f7cfe333a96a642ebc8ce",
  );
});
