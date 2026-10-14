import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  SubagentProfileConfiguration,
  SubagentProfileDiagnostic,
} from "@nervekit/contracts/subagents";
import {
  conversationProfileCounts,
  conversationProfileProblem,
  conversationProfileRowDiagnostics,
} from "./conversation-profile-diagnostics";

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

function profile(
  overrides: Partial<SubagentProfileConfiguration> = {},
): SubagentProfileConfiguration {
  return {
    name: "explore",
    local: null,
    inherited: null,
    effective: {
      name: "explore",
      label: "Explore",
      description: "Research",
      enabled: true,
      model: "lead",
      thinking: "lead",
      permission: "read_only",
      compaction: "inherit",
      tools: {},
      skills: "inherit",
      instructions: "Look around.",
      source: "builtin",
      trust: "trusted",
    },
    origins: { fields: {}, tools: {}, skills: {} },
    trust: "trusted",
    diagnostics: [],
    ...overrides,
  } as SubagentProfileConfiguration;
}

test("summarizes row problems in one short line and keeps the full text", () => {
  assert.equal(conversationProfileProblem(profile(), []), undefined);
  const unavailable: SubagentProfileDiagnostic = {
    code: "unavailable_model",
    severity: "blocking",
    field: "model",
    message: "Model a/b is not available (offline). Choose another model.",
  };
  assert.deepEqual(
    conversationProfileProblem(profile({ diagnostics: [unavailable] }), []),
    {
      blocking: true,
      message: "Model not available",
      detail: unavailable.message,
    },
  );
  const warning: SubagentProfileDiagnostic = {
    code: "something_new",
    severity: "warning",
    message: "First sentence. Second sentence.",
  };
  assert.deepEqual(
    conversationProfileProblem(profile({ diagnostics: [warning] }), []),
    { blocking: false, message: "First sentence.", detail: warning.message },
  );
});

test("untrusted project settings block the profile", () => {
  const problem = conversationProfileProblem(
    profile({ trust: "untrusted" }),
    [],
  );
  assert.equal(problem?.blocking, true);
  assert.equal(problem?.message, "Project settings need review");
});

test("shared document errors block rows without repeating the message", () => {
  const problem = conversationProfileProblem(
    profile({ diagnostics: [documentError] }),
    [documentError],
  );
  assert.deepEqual(problem, {
    blocking: true,
    message: "Unavailable",
    detail: "Unavailable",
  });
});

test("counts only enabled, usable profiles", () => {
  const base = profile();
  const off = profile({
    name: "off",
    effective: { ...base.effective!, name: "off", enabled: false },
  });
  const broken = profile({ name: "broken", effective: null });
  assert.deepEqual(
    conversationProfileCounts({
      scope: "conversation",
      document: null,
      digest: null,
      trust: "trusted",
      diagnostics: [],
      profiles: [base, off, broken],
    }),
    { enabled: 1, total: 3 },
  );
});
