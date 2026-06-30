import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  displayLimitNotice,
  formatIssueSummaryLine,
  JIRA_DISPLAY_ITEM_LIMIT,
  JIRA_TEXT_FIELD_MAX_CHARS,
  summarizeJiraIssue,
  summarizeJiraTransition,
  takeDisplayItems,
} from "../src/execution/jira/format.js";

describe("Jira result formatting", () => {
  it("summarizes issues without carrying raw Jira field payloads", () => {
    const longSummary = "x".repeat(JIRA_TEXT_FIELD_MAX_CHARS + 20);
    const summary = summarizeJiraIssue({
      id: "10001",
      key: "NER-123",
      fields: {
        summary: longSummary,
        issuetype: { name: "Bug", iconUrl: "https://example.test/icon.png" },
        status: {
          name: "In Progress",
          statusCategory: { key: "indeterminate" },
        },
        assignee: { displayName: "Jane Doe", accountId: "secret-account-id" },
        priority: { name: "High" },
        updated: "2026-06-30T00:00:00.000Z",
        description: { content: [{ deeply: "large" }] },
      },
    });

    if (!summary) assert.fail("expected issue summary");
    assert.equal(summary.key, "NER-123");
    assert.equal(summary.issueType, "Bug");
    assert.equal(summary.status, "In Progress");
    assert.equal(summary.assignee, "Jane Doe");
    assert.equal(summary.priority, "High");
    assert.equal(summary.summary?.length, JIRA_TEXT_FIELD_MAX_CHARS);
    assert.equal("fields" in summary, false);
    assert.equal(
      formatIssueSummaryLine(summary),
      `- NER-123 · Bug · In Progress · priority: High · assignee: Jane Doe — ${summary.summary}`,
    );
  });

  it("caps displayed collections and emits a notice pointing to the raw artifact", () => {
    const items = Array.from(
      { length: JIRA_DISPLAY_ITEM_LIMIT + 5 },
      (_, index) => index,
    );
    const display = takeDisplayItems(items);

    assert.equal(display.items.length, JIRA_DISPLAY_ITEM_LIMIT);
    assert.equal(display.total, JIRA_DISPLAY_ITEM_LIMIT + 5);
    assert.equal(display.omitted, 5);
    assert.match(
      displayLimitNotice({
        noun: "issue",
        total: display.total,
        displayed: display.displayed,
        artifactPath: "/tmp/jira.json",
      }) ?? "",
      /Showing first 20 of 25 issues; full Jira response is saved to \/tmp\/jira\.json\./,
    );
  });

  it("summarizes transitions to id, name, and destination only", () => {
    const summary = summarizeJiraTransition({
      id: "31",
      name: "Done",
      to: { name: "Done", statusCategory: { key: "done" } },
      fields: { resolution: { required: true } },
    });

    assert.deepEqual(summary, { id: "31", name: "Done", to: "Done" });
  });
});
