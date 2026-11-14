import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSignature } from "./sdk-dts.js";
import type { SdkMethod } from "./sdk-types.js";

const method = (signature: string) =>
  ({ product: "p", path: "g.read", signature }) as SdkMethod;

void test("parseSignature: splits an optional one-line doc comment from the declaration", () => {
  assert.deepEqual(
    parseSignature(method("/**  Reads. */\n\tread(a: string): void")),
    { doc: "Reads.", declaration: "read(a: string): void" },
  );
  assert.deepEqual(parseSignature(method("read(): void")), {
    doc: undefined,
    declaration: "read(): void",
  });
});

void test("parseSignature: rejects declarations that do not start with the method name", () => {
  assert.throws(
    () => parseSignature(method("/** a\nb */ read()")),
    /must declare read/,
  );
});

void test("parseSignature: stays linear on pathological manifest input", () => {
  const started = performance.now();
  assert.throws(() => parseSignature(method(`/**${"\t".repeat(200_000)}x`)));
  assert.throws(() => parseSignature(method(`/**${" ".repeat(200_000)}\n*/`)));
  assert.ok(performance.now() - started < 500);
});
