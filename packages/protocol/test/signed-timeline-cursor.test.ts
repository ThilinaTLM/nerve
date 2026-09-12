import assert from "node:assert/strict";
import test from "node:test";
import { SignedTimelineCursorCodec } from "../src/index.js";

const payload = {
  version: 1 as const,
  view: {
    conversationId: "conv_one",
    sourceHeadEntryId: "entry_two",
    sourceRevision: 2,
    projection: {
      canonicalRevision: 2,
      appliedRevision: 2,
      schemaVersion: 1,
      policyVersion: 1,
      rebuildGeneration: 1,
    },
    visibilityId: "default",
    filterId: "transcript",
    ordering: "ancestry_ascending" as const,
    executionIncarnationId: "incarnation_one",
  },
  lastDisplayOrderKey: "0000000000000001",
};

test("INV-PAGE-01 signs every fixed-view cursor field", async () => {
  const codec = new SignedTimelineCursorCodec(new Uint8Array(32).fill(7));
  const cursor = await codec.encode(payload);
  assert.deepEqual(await codec.decode(cursor), payload);
  const [body, signature] = cursor.split(".");
  const tampered = `${body!.slice(0, -1)}A.${signature}`;
  assert.equal(await codec.decode(tampered), undefined);
  assert.equal(
    await codec.decode(`${body}.${signature!.slice(0, -1)}A`),
    undefined,
  );
});
