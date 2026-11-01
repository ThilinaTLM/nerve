import assert from "node:assert/strict";
import { test } from "node:test";
import { cn, tv } from "./utils";

test("type roles are font sizes, not colours, when merging classes", () => {
  assert.equal(cn("text-ui", "text-foreground"), "text-ui text-foreground");
  assert.equal(
    cn("text-caption text-muted-foreground", "text-title"),
    "text-muted-foreground text-title",
  );
  assert.equal(cn("text-destructive", "text-success"), "text-success");
});

test("variant classes keep their type role next to colour variants", () => {
  const chip = tv({
    base: "text-ui",
    variants: { tone: { muted: "text-muted-foreground" } },
  });
  assert.equal(chip({ tone: "muted" }), "text-ui text-muted-foreground");
});
