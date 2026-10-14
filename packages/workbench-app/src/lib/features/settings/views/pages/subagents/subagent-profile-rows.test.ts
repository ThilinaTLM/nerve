import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  SubagentProfile,
  SubagentProfileConfiguration,
  SubagentProfileDiagnostic,
} from "@nervekit/contracts/subagents";
import {
  canResetProfileEntry,
  groupProfilesByOrigin,
  profileDiagnosticSummary,
  profileResetConfirmation,
  profileRowActions,
  profileRowDiagnostics,
  profileRowProblems,
  profileTrustReviewEntries,
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

function configured(
  name: string,
  origin: "builtin" | "user" | "project",
  local: SubagentProfileConfiguration["local"] = null,
): SubagentProfileConfiguration {
  return {
    name,
    local,
    inherited: origin === "builtin" ? { model: "lead" } : null,
    effective: { ...base, name, label: name },
    origins: {
      fields: {
        description: origin,
        model: origin,
        ...(local?.model ? { model: "project" as const } : {}),
      },
      tools: {},
      skills: {},
    },
    trust: "trusted",
    diagnostics: [],
  };
}

describe("profile list", () => {
  it("groups profiles by the layer that created them and skips empty groups", () => {
    const groups = groupProfilesByOrigin(
      [
        configured("explore", "builtin"),
        configured("reviewer", "user"),
        configured("release", "project"),
      ],
      "project",
    );
    assert.deepEqual(
      groups.map((group) => [group.title, group.profiles.map((p) => p.name)]),
      [
        ["Project profiles", ["release"]],
        ["From User", ["reviewer"]],
        ["Built-in", ["explore"]],
      ],
    );
    assert.deepEqual(
      groupProfilesByOrigin([configured("explore", "builtin")], "user").map(
        (group) => group.title,
      ),
      ["Built-in"],
    );
  });

  it("offers only applicable row actions and never deletes built-ins", () => {
    const builtin = profileRowActions(
      configured("explore", "builtin", { model: "a/b" }),
      "project",
      { canCopyToProject: true },
    );
    assert.equal(builtin.delete, false);
    assert.equal(builtin.resetCustomizations, true);
    assert.equal(builtin.copyTo, undefined);

    const own = profileRowActions(
      configured("reviewer", "user", { label: "Reviewer" }),
      "user",
      { canCopyToProject: true },
    );
    assert.equal(own.delete, true);
    assert.equal(own.resetCustomizations, false);
    assert.equal(own.copyTo, "project");
    assert.equal(
      profileRowActions(configured("reviewer", "user", {}), "user", {
        canCopyToProject: false,
      }).copyTo,
      undefined,
    );

    const inherited = profileRowActions(
      configured("reviewer", "user"),
      "project",
      { canCopyToProject: true },
    );
    assert.equal(inherited.resetCustomizations, false);
    assert.equal(inherited.delete, false);
    assert.equal(inherited.copyTo, undefined);
  });

  it("flags blocking, reduced and untrusted rows", () => {
    const profile = configured("explore", "builtin");
    assert.deepEqual(
      profileRowProblems(
        {
          ...profile,
          trust: "untrusted",
          diagnostics: [
            { severity: "warning", code: "unavailable_tool", message: "x" },
          ],
        },
        [],
        "project",
      ),
      {
        diagnostics: [
          { severity: "warning", code: "unavailable_tool", message: "x" },
        ],
        blocked: false,
        reduced: true,
        needsReview: true,
      },
    );
  });

  it("names each reset change with its before and after value", () => {
    const confirmation = profileResetConfirmation(
      configured("explore", "builtin", { model: "x/y" }),
      "project",
      [],
    );
    assert.equal(confirmation.title, "Reset explore for this project?");
    assert.match(confirmation.description, /model \(x\/y → Same as lead\)/);
    assert.match(confirmation.description, /User and Built-in values/);
    assert.match(confirmation.description, /Teammates/);
    assert.equal(confirmation.confirmLabel, "Reset 1 change");
  });

  it("lists what each untrusted project entry sets", () => {
    const [entry] = profileTrustReviewEntries(
      {
        schemaVersion: 1,
        profiles: {
          release: {
            label: "Release",
            permission: "autonomous",
            instructions: "Ship it",
          },
        },
      },
      [],
      [],
    );
    assert.deepEqual(entry, {
      name: "release",
      label: "Release",
      isNew: true,
      autonomous: true,
      instructions: "Ship it",
      fields: [{ label: "permission", value: "Autonomous" }],
    });
  });
});
