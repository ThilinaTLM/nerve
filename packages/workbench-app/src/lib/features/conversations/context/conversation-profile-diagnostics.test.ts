import assert from "node:assert/strict";
import { test } from "node:test";
import type { SubagentProfileDiagnostic } from "@nervekit/contracts/subagents";
import { conversationProfileRowDiagnostics } from "./conversation-profile-diagnostics";

const documentError: SubagentProfileDiagnostic = {
  code: "invalid_document",
  source: "user",
  severity: "blocking",
  message: "Invalid profile document",
};

test("omits only identical shared document errors from profile rows", () => {
  const rowError = { ...documentError, code: "invalid_entry" };
  const diagnostics = [documentError, rowError];
  assert.deepEqual(
    conversationProfileRowDiagnostics(diagnostics, [{ ...documentError }]),
    [rowError],
  );
  assert.deepEqual(diagnostics, [documentError, rowError]);
});

test("retains other-source, distinct-message, and distinct-severity document errors", () => {
  const diagnostics: SubagentProfileDiagnostic[] = [
    { ...documentError, source: "project" },
    { ...documentError, message: "Another document error" },
    { ...documentError, severity: "warning" },
  ];
  assert.deepEqual(
    conversationProfileRowDiagnostics(diagnostics, [documentError]),
    diagnostics,
  );
});

test("never suppresses row-local diagnostics or non-document warnings", () => {
  const diagnostics: SubagentProfileDiagnostic[] = [
    { ...documentError, field: "model" },
    { ...documentError, reference: "developer" },
    {
      code: "unavailable_skill",
      source: "user",
      severity: "warning",
      message: "Unknown skill",
      reference: "portable-skill",
    },
  ];
  assert.deepEqual(
    conversationProfileRowDiagnostics(diagnostics, diagnostics),
    diagnostics,
  );
});

test("keeps document errors when no matching shared error is displayed", () => {
  assert.deepEqual(conversationProfileRowDiagnostics([documentError], []), [
    documentError,
  ]);
  assert.deepEqual(
    conversationProfileRowDiagnostics(
      [documentError],
      [{ ...documentError, field: "profiles" }],
    ),
    [documentError],
  );
});
