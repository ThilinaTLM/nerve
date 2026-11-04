import assert from "node:assert/strict";
import test from "node:test";
import { RpcError } from "@nervekit/protocol/rpc";
import {
  formatSearchPatternError,
  searchPatternError,
} from "./content-search-error";

const rpc = (details?: Record<string, unknown>, message = "Unclosed group") =>
  new RpcError({
    code: "DOMAIN_VALIDATION_FAILED",
    message,
    retryable: false,
    details,
  });

test("reads a structured invalid-pattern error", () => {
  const parsed = searchPatternError(
    rpc({ code: "INVALID_SEARCH_PATTERN", column: 4 }),
  );
  assert.deepEqual(parsed, { message: "Unclosed group", column: 4 });
  assert.equal(formatSearchPatternError(parsed!), "Unclosed group (column 4)");
  assert.equal(
    formatSearchPatternError({ message: "Unclosed group" }),
    "Unclosed group",
  );
});

test("ignores unrelated failures", () => {
  assert.equal(searchPatternError(rpc()), undefined);
  assert.equal(searchPatternError(new Error("boom")), undefined);
});
