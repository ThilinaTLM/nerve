import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  SubagentProfile,
  SubagentProfileConfiguration,
  SubagentProfileDiagnostic,
} from "@nervekit/contracts/subagents";
import {
  canResetProfileEntry,
  profileSummary,
  profileDiagnosticSummary,
  profileRowDiagnostics,
} from "./subagent-profile-rows";

const base: SubagentProfile = {
  name: "scout",
  label: "Scout",
  description: "Scouts.",
  enabled: true,
  source: "user",
  model: "lead",
  thinking: "lead",
  permission: "read_only",
  compaction: "inherit",
  tools: {},
  skills: "none",
  instructions: "",
};
it("offers whole-entry reset for an invalid entry only in its owning scope", () => {
  const invalid: SubagentProfileConfiguration = {
    name: "scout",
    local: null,
    inherited: null,
    effective: null,
    origins: { fields: {}, tools: {}, skills: {} },
    trust: "trusted",
    diagnostics: [
      {
        severity: "blocking",
        code: "invalid_entry",
        source: "project",
        message: "Malformed entry",
      },
    ],
  };
  assert.equal(canResetProfileEntry(invalid, "project"), true);
  assert.equal(canResetProfileEntry(invalid, "user"), false);
  assert.equal(
    canResetProfileEntry({ ...invalid, diagnostics: [] }, "project"),
    false,
  );
  assert.equal(
    canResetProfileEntry({ ...invalid, local: {} }, "project"),
    true,
  );
});

describe("profile diagnostics", () => {
  const documentError: SubagentProfileDiagnostic = {
    severity: "blocking",
    code: "invalid_document",
    source: "user",
    message: '[{"code":"invalid_value","path":["schemaVersion"]}]',
  };
  const configuration: SubagentProfileConfiguration = {
    name: base.name,
    effective: base,
    local: null,
    inherited: null,
    origins: { fields: {}, tools: {}, skills: {} },
    trust: "trusted",
    diagnostics: [documentError],
  };

  it("shows document failures once and distinguishes inherited configuration blocking", () => {
    assert.deepEqual(
      profileRowDiagnostics(configuration, [documentError], "project"),
      {
        diagnostics: [],
        documentBlock:
          "Blocked by inherited user configuration. See the document error above.",
      },
    );
    assert.equal(
      profileRowDiagnostics(configuration, [documentError], "user")
        .documentBlock,
      "Blocked by user configuration. See the document error above.",
    );
  });

  it("retains profile-local errors and warnings even with a document blocker", () => {
    const local: SubagentProfileDiagnostic = {
      ...documentError,
      code: "invalid_entry",
      source: "project",
    };
    const warning: SubagentProfileDiagnostic = {
      severity: "warning",
      code: "unavailable_tool",
      reference: "portable_tool",
      message: "Tool unavailable",
    };
    const row = profileRowDiagnostics(
      { ...configuration, diagnostics: [documentError, local, warning] },
      [documentError],
      "project",
    );
    assert.deepEqual(row.diagnostics, [local, warning]);
    assert.ok(row.documentBlock);
  });

  it("does not hide a document diagnostic that has no page-level explanation", () => {
    assert.deepEqual(profileRowDiagnostics(configuration, [], "user"), {
      diagnostics: [documentError],
    });
  });

  it("keeps actionable legacy migration and incomplete-profile messages primary", () => {
    const legacy =
      "Legacy subagents.json requires migration to the versioned profiles document. Review the migration backup before restoring configuration; the original file has not been changed.";
    assert.equal(
      profileDiagnosticSummary({ ...documentError, message: legacy }),
      legacy,
    );
    const incomplete =
      "Profile reviewer is missing description and model. Edit these fields in user Settings; existing instructions and tool selections are preserved.";
    assert.equal(
      profileDiagnosticSummary({
        ...documentError,
        code: "incomplete_profile",
        message: incomplete,
      }),
      incomplete,
    );
    const readable =
      "Review {profiles} in subagents.json; do not replace the existing document.";
    assert.equal(
      profileDiagnosticSummary({ ...documentError, message: readable }),
      readable,
    );
  });

  it("summarizes giant and truncated Zod payloads while retaining raw details", () => {
    const payload = JSON.stringify(
      Array.from({ length: 100 }, () => ({
        code: "invalid_type",
        path: ["profiles", "reviewer", "description"],
        message: "Expected string",
      })),
    );
    const diagnostic = { ...documentError, message: payload };
    assert.equal(
      profileDiagnosticSummary(diagnostic),
      profileDiagnosticSummary(documentError),
    );
    assert.equal(
      diagnostic.message,
      payload,
      "raw details remain available for the disclosure",
    );
    assert.equal(
      profileDiagnosticSummary({
        ...diagnostic,
        message: `ZodError: ${payload}`,
      }),
      profileDiagnosticSummary(documentError),
    );
    assert.equal(
      profileDiagnosticSummary({
        ...diagnostic,
        message: '[{"code":"invalid_type","path":[',
      }),
      profileDiagnosticSummary(documentError),
    );
  });

  it("provides actionable structural-error summaries without leaking raw validator output", () => {
    assert.match(
      profileDiagnosticSummary(documentError),
      /user subagents\.json/,
    );
    assert.match(profileDiagnosticSummary(documentError), /Correct or restore/);
    assert.ok(
      !profileDiagnosticSummary(documentError).includes("schemaVersion"),
    );
    assert.match(
      profileDiagnosticSummary({ ...documentError, code: "invalid_entry" }),
      /owning scope/,
    );
    assert.match(
      profileDiagnosticSummary({
        ...documentError,
        code: "incomplete_profile",
      }),
      /required settings/,
    );
    assert.equal(
      profileDiagnosticSummary({
        ...documentError,
        code: "model_unavailable",
        message: "Configure this model",
      }),
      "Configure this model",
    );
  });
});

describe("profile summary", () => {
  it("summarizes model, thinking and permissions", () => {
    assert.equal(profileSummary(base, []), "Lead's model · Read-only");
    assert.equal(
      profileSummary(
        { ...base, model: "x/y", thinking: "high", permission: "autonomous" },
        [],
      ),
      "x/y · high thinking · Autonomous",
    );
  });
});
