import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  defaultSettingsPageId,
  layoutByScope,
  pagesByScope,
  resolveSettingsPageId,
  settingsPageIds,
} from "./settings-page-data";

const grouped = (kind: "user" | "project") =>
  layoutByScope[kind].map((group) => [group.title, group.pages]);

describe("settings page registry", () => {
  it("groups the user nav as approved", () => {
    assert.deepEqual(grouped("user"), [
      ["Connections", ["providers", "integrations"]],
      ["Agent", ["general", "tools", "skills"]],
      [
        "Catalog",
        ["agents", "sub-agents", "permission-rules", "models", "suggestions"],
      ],
      ["App", ["workbench", "notifications", "shortcuts", "voice"]],
      ["System", ["storage", "system"]],
    ]);
  });

  it("groups the project nav as approved", () => {
    assert.deepEqual(grouped("project"), [
      ["Agent", ["general", "tools", "skills"]],
      ["Catalog", ["agents", "sub-agents", "permission-rules", "suggestions"]],
      ["This project", ["launch", "instructions-files", "trust"]],
    ]);
  });

  it("defines a page with sections for every nav entry", () => {
    for (const kind of ["user", "project"] as const)
      for (const id of settingsPageIds(kind))
        assert.ok(
          pagesByScope[kind][id]?.sections.length,
          `${kind}/${id} has no sections`,
        );
  });

  it("sends stale or foreign page ids to the scope default", () => {
    for (const old of [
      "agent-profiles",
      "profiles",
      "transcription",
      "permissions",
    ])
      assert.equal(
        resolveSettingsPageId("user", old),
        defaultSettingsPageId("user"),
      );
    assert.equal(resolveSettingsPageId("project", "providers"), "general");
    assert.equal(resolveSettingsPageId("project", "trust"), "trust");
    assert.equal(resolveSettingsPageId("user", undefined), "providers");
  });
});
