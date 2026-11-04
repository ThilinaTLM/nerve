import assert from "node:assert/strict";
import { test } from "node:test";
import { translateApplicationError } from "../../adapters/protocol/application-error-translation.js";
import { mapContentSearchError } from "./project-path-index.js";

void test("maps an invalid pattern to a structured 422 with a column", () => {
  const error = mapContentSearchError(
    new Error("INVALID_SEARCH_PATTERN:3:Unclosed character class"),
  );
  assert.equal(error.status, 422);
  assert.equal(error.code, "INVALID_SEARCH_PATTERN");
  assert.equal(error.message, "Unclosed character class");
  assert.deepEqual(error.options.details, {
    code: "INVALID_SEARCH_PATTERN",
    column: 3,
  });
  assert.deepEqual(translateApplicationError(error).details, {
    code: "INVALID_SEARCH_PATTERN",
    column: 3,
  });
});

void test("omits the column when the engine gave none", () => {
  const error = mapContentSearchError(
    new Error("INVALID_SEARCH_PATTERN::Unclosed group"),
  );
  assert.deepEqual(error.options.details, { code: "INVALID_SEARCH_PATTERN" });
});

void test("other failures stay generic", () => {
  const error = mapContentSearchError(new Error("Invalid glob 'x'"));
  assert.equal(error.status, 400);
  assert.equal(error.code, "CONTENT_SEARCH_FAILED");
});
