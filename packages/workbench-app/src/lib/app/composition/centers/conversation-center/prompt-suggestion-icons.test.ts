import assert from "node:assert/strict";
import { test } from "node:test";
import { suggestionIconKey } from "./prompt-suggestion-icons";

test("built-in suggestions get their dedicated icon", () => {
  assert.equal(
    suggestionIconKey({ name: "push-commits", source: { kind: "builtin" } }),
    "push",
  );
});

test("unknown built-ins and non-built-in sources use the default icon", () => {
  assert.equal(
    suggestionIconKey({ name: "nope", source: { kind: "builtin" } }),
    "default",
  );
  assert.equal(
    suggestionIconKey({ name: "push-commits", source: { kind: "user" } }),
    "default",
  );
  assert.equal(
    suggestionIconKey({ name: "toString", source: { kind: "builtin" } }),
    "default",
  );
});
