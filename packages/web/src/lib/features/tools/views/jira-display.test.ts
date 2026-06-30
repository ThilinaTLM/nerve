import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  jiraInitials,
  jiraIssueUrl,
  jiraPriorityTone,
  jiraStatusTone,
} from "./jira-display";

describe("jira-display helpers", () => {
  it("prefers the status category over the name heuristic", () => {
    assert.equal(jiraStatusTone("Anything", "new"), "neutral");
    assert.equal(jiraStatusTone("Anything", "indeterminate"), "running");
    assert.equal(jiraStatusTone("Anything", "done"), "good");
  });

  it("falls back to a status-name heuristic without a category", () => {
    assert.equal(jiraStatusTone("In Progress"), "running");
    assert.equal(jiraStatusTone("In Review"), "running");
    assert.equal(jiraStatusTone("Done"), "good");
    assert.equal(jiraStatusTone("Resolved"), "good");
    assert.equal(jiraStatusTone("Blocked"), "danger");
    assert.equal(jiraStatusTone("To Do"), "neutral");
    assert.equal(jiraStatusTone(undefined), "neutral");
  });

  it("builds browse URLs and omits them without a site URL", () => {
    assert.equal(
      jiraIssueUrl("https://acme.atlassian.net", "NER-1"),
      "https://acme.atlassian.net/browse/NER-1",
    );
    assert.equal(
      jiraIssueUrl("https://acme.atlassian.net/", "NER-1"),
      "https://acme.atlassian.net/browse/NER-1",
    );
    assert.equal(jiraIssueUrl(undefined, "NER-1"), undefined);
    assert.equal(jiraIssueUrl("   ", "NER-1"), undefined);
  });

  it("derives avatar initials from name, email, then accountId", () => {
    assert.equal(
      jiraInitials({ displayName: "Jane Doe", accountId: "x" }),
      "JD",
    );
    assert.equal(jiraInitials({ displayName: "Cher", accountId: "x" }), "CH");
    assert.equal(
      jiraInitials({ emailAddress: "john.smith@acme.io", accountId: "x" }),
      "JS",
    );
    assert.equal(jiraInitials({ accountId: "ab12" }), "AB");
  });

  it("maps priorities to tones", () => {
    assert.equal(jiraPriorityTone("High"), "warn");
    assert.equal(jiraPriorityTone("Highest"), "danger");
    assert.equal(jiraPriorityTone("Medium"), "neutral");
    assert.equal(jiraPriorityTone("Lowest"), "neutral");
    assert.equal(jiraPriorityTone("Unknown"), undefined);
    assert.equal(jiraPriorityTone(undefined), undefined);
  });
});
