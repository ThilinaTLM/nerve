import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ToolCallTranscriptRecord } from "../../state/tool-types";
import { isInputValidationFailure } from "./failure-context";

function failure(
  status: ToolCallTranscriptRecord["status"],
  code?: string,
): Pick<ToolCallTranscriptRecord, "status" | "errorDetails"> {
  return {
    status,
    errorDetails: code ? { code, message: "Tool failed." } : undefined,
  };
}

describe("isInputValidationFailure", () => {
  it("recognizes canonical and tool-specific argument validation codes", () => {
    assert.equal(
      isInputValidationFailure(failure("error", "INVALID_TOOL_ARGUMENTS")),
      true,
    );
    assert.equal(
      isInputValidationFailure(failure("error", "TOOL_ARGUMENT_INVALID")),
      true,
    );
    assert.equal(
      isInputValidationFailure(failure("error", "EDIT_ARGUMENT_INVALID")),
      true,
    );
  });

  it("does not classify execution errors or non-error terminal states", () => {
    assert.equal(
      isInputValidationFailure(failure("error", "INTERNAL_ERROR")),
      false,
    );
    assert.equal(isInputValidationFailure(failure("error")), false);
    assert.equal(
      isInputValidationFailure(failure("denied", "INVALID_TOOL_ARGUMENTS")),
      false,
    );
    assert.equal(
      isInputValidationFailure(failure("completed", "INVALID_TOOL_ARGUMENTS")),
      false,
    );
  });
});
