import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PromptSuggestionStatus } from "@nervekit/contracts/prompt-suggestions";
import { awaitsReview, suggestionWrites } from "./suggestions-view";

const status = (
  patch: Partial<PromptSuggestionStatus> = {},
): PromptSuggestionStatus => ({
  definitionKey: "builtin:continue",
  name: "continue",
  label: "Continue",
  path: "builtin:continue",
  sourceKind: "builtin",
  requiresTrust: false,
  status: "not_required",
  enabled: true,
  defaultEnabled: true,
  ...patch,
});

describe("suggestionWrites", () => {
  it("writes the user layer only for a user change", async () => {
    assert.deepEqual(
      await suggestionWrites(status(), "user", false, "proj_1"),
      [{ definitionKey: "builtin:continue", enabled: false, scope: "user" }],
    );
  });

  it("clears the project choice when it matches User again", async () => {
    const writes = await suggestionWrites(
      status({ projectEnabled: false, enabled: false }),
      "project",
      true,
      "proj_1",
    );
    assert.deepEqual(writes, [
      {
        definitionKey: "builtin:continue",
        enabled: null,
        scope: "project",
        projectId: "proj_1",
      },
    ]);
  });

  it("clears a project choice a user change makes redundant", async () => {
    const writes = await suggestionWrites(
      status({ projectEnabled: false, enabled: false }),
      "user",
      false,
      "proj_1",
    );
    assert.deepEqual(
      writes.map((w) => [w.scope, w.enabled]),
      [
        ["user", false],
        ["project", null],
      ],
    );
  });

  it("gives project-defined suggestions a project layer only", async () => {
    const writes = await suggestionWrites(
      status({ sourceKind: "project", defaultEnabled: true }),
      "project",
      false,
      "proj_1",
    );
    assert.deepEqual(
      writes.map((w) => [w.scope, w.enabled]),
      [["project", false]],
    );
  });
});

describe("awaitsReview", () => {
  it("asks for review of unreviewed files only", () => {
    assert.equal(
      awaitsReview(status({ requiresTrust: true, status: "needs_review" })),
      true,
    );
    assert.equal(
      awaitsReview(status({ requiresTrust: true, status: "trusted" })),
      false,
    );
    assert.equal(awaitsReview(status()), false);
  });
});
