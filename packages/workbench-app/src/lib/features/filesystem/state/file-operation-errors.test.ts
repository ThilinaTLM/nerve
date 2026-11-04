import assert from "node:assert/strict";
import { test } from "node:test";
import {
  describeFileOperationError,
  fileOperationErrorCode,
} from "./file-operation-errors";

test("reads codes from API errors and protocol error data", () => {
  assert.equal(
    fileOperationErrorCode(Object.assign(new Error("x"), { code: "A" })),
    "A",
  );
  assert.equal(
    fileOperationErrorCode(
      Object.assign(new Error("x"), { data: { code: "B" } }),
    ),
    "B",
  );
  assert.equal(fileOperationErrorCode("nope"), undefined);
});

test("maps known codes to friendly text and falls back to the message", () => {
  assert.match(
    describeFileOperationError(
      Object.assign(new Error("raw"), { data: { code: "PROJECT_ENTRY_EXISTS" } }),
    ),
    /already exists/,
  );
  assert.equal(describeFileOperationError(new Error("boom")), "boom");
});
