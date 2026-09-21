import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { integrationToolEnabled } from "../../../src/domains/tools/orchestration/integration-tool-availability.js";

describe("integrationToolEnabled", () => {
  it("honors resolved capability enablement over the user default", () => {
    assert.equal(
      integrationToolEnabled({
        name: "jira",
        settings: { enabled: false, profileId: "atlassian" },
        disabledToolNames: [],
      }),
      true,
    );
  });

  it("honors a resolved conversation disable", () => {
    assert.equal(
      integrationToolEnabled({
        name: "confluence",
        settings: { enabled: true, profileId: "atlassian" },
        disabledToolNames: ["confluence"],
      }),
      false,
    );
  });

  it("requires a configured provider profile", () => {
    assert.equal(
      integrationToolEnabled({
        name: "jira",
        settings: { enabled: true },
        disabledToolNames: [],
      }),
      false,
    );
  });

  it("falls back to the user setting without a resolved selection", () => {
    assert.equal(
      integrationToolEnabled({
        name: "jira",
        settings: { enabled: false, profileId: "atlassian" },
      }),
      false,
    );
    assert.equal(
      integrationToolEnabled({
        name: "jira",
        settings: { enabled: true, profileId: "atlassian" },
      }),
      true,
    );
  });
});
