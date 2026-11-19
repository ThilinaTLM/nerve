import assert from "node:assert/strict";
import test from "node:test";
import { base64ToBlob } from "./clipboard-image";

test("decodes base64 into a typed blob", async () => {
  const blob = base64ToBlob("AQID", "image/png");
  assert.equal(blob?.type, "image/png");
  assert.deepEqual(
    new Uint8Array((await blob?.arrayBuffer()) ?? []),
    new Uint8Array([1, 2, 3]),
  );
});

test("rejects invalid base64", () => {
  assert.equal(base64ToBlob("***", "image/png"), undefined);
});
