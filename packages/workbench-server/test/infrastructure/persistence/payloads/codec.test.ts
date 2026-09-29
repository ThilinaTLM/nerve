import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createJsonPayloadCodec,
  UnsupportedPayloadVersionError,
} from "../../../../src/infrastructure/persistence/payloads/codec.js";
import { mergePreservingUnknown } from "../../../../src/infrastructure/persistence/payloads/merge.js";

describe("payload codec", () => {
  it("runs every version upgrader before the read schema", () => {
    const codec = createJsonPayloadCodec({
      currentVersion: 3,
      upgraders: {
        1: (value) => mergePreservingUnknown(value, { nested: { added: 1 } }),
        2: (value) => mergePreservingUnknown(value, { current: true }),
      },
      read: (value) => value as Record<string, unknown>,
    });

    const decoded = codec.decode(
      JSON.stringify({ nested: { retained: "yes" }, future: 42 }),
      1,
    );
    assert.deepEqual(decoded, {
      nested: { retained: "yes", added: 1 },
      future: 42,
      current: true,
    });
  });

  it("preserves raw unknown fields recursively around a projected read shape", () => {
    const codec = createJsonPayloadCodec({
      currentVersion: 1,
      read: (value) => {
        const input = value as {
          known: string;
          nested: { known: number };
          items: Array<{ known: boolean }>;
        };
        return {
          known: input.known,
          nested: { known: input.nested.known },
          items: input.items.map(({ known }) => ({ known })),
        };
      },
    });
    const raw = {
      known: "value",
      extension: "top-level",
      nested: { known: 1, extension: "nested" },
      items: [{ known: true, extension: "array-item" }],
    };

    const decoded = codec.decode(JSON.stringify(raw), 1);
    assert.deepEqual(decoded, raw);
    assert.deepEqual(
      JSON.parse(Buffer.from(codec.encode(raw)).toString()),
      raw,
    );
  });

  it("validates through the same upgrader and read-schema failures", () => {
    const codec = createJsonPayloadCodec({
      currentVersion: 2,
      upgraders: { 1: (value) => ({ ...(value as object), upgraded: true }) },
      read: (value) => {
        const input = value as { required?: unknown; upgraded?: unknown };
        if (input.required !== "yes" || input.upgraded !== true) {
          throw new Error("invalid persisted payload");
        }
        return input;
      },
    });

    assert.doesNotThrow(() =>
      codec.validate(JSON.stringify({ required: "yes" }), 1),
    );
    assert.throws(
      () => codec.validate(JSON.stringify({ required: "no" }), 1),
      /invalid persisted payload/,
    );
    assert.throws(
      () => codec.validate("{}", 3),
      UnsupportedPayloadVersionError,
    );
    assert.throws(() => codec.validate("not-json", 2), SyntaxError);
  });

  it("validation does not reconstruct a preserved decoded value", () => {
    const codec = createJsonPayloadCodec({
      currentVersion: 1,
      read: () => ({ nonCloneable: () => undefined }),
    });

    assert.doesNotThrow(() => codec.validate("{}", 1));
    assert.throws(() => codec.decode("{}", 1), /could not be cloned/);
  });

  it("rejects unknown future versions and gaps in the chain", () => {
    const codec = createJsonPayloadCodec({
      currentVersion: 2,
      read: (value) => value,
    });
    assert.throws(() => codec.decode("{}", 3), UnsupportedPayloadVersionError);
    assert.throws(
      () => codec.decode("{}", 1),
      /No payload upgrader from version 1 to 2/,
    );
  });
});

describe("mergePreservingUnknown", () => {
  it("recursively retains unknown object fields and replaces arrays", () => {
    const original = {
      known: { old: true, extension: { enabled: true } },
      list: [1, 2],
      topLevelExtension: "retained",
    };
    const merged = mergePreservingUnknown(original, {
      known: { old: false },
      list: [3],
    });

    assert.deepEqual(merged, {
      known: { old: false, extension: { enabled: true } },
      list: [3],
      topLevelExtension: "retained",
    });
    assert.deepEqual(original.list, [1, 2]);
  });
});
