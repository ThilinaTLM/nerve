import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  confluenceResultDetailsSchema,
  jiraResultDetailsSchema,
} from "../src/index.js";

describe("Atlassian normalized result summaries", () => {
  it("accepts board, sprint, and attachment display resources", () => {
    const parsed = jiraResultDetailsSchema.safeParse({
      action: "get_board",
      board: {
        id: "34",
        name: "NER board",
        type: "scrum",
        projectKey: "NER",
      },
      sprints: [{ id: "7", name: "Sprint 7", state: "active" }],
      backlogIssues: [{ key: "NER-18", summary: "Smoke test" }],
      attachment: {
        id: "9",
        filename: "report.pdf",
        mediaType: "application/pdf",
        bytes: 42,
      },
    });
    assert.equal(parsed.success, true);
  });

  it("accepts bounded issue and page previews with chaining identities", () => {
    const jira = jiraResultDetailsSchema.safeParse({
      issue: {
        key: "NER-14",
        created: "2026-08-01T00:00:00Z",
        resolution: "Done",
        resolutionDate: "2026-08-02T00:00:00Z",
        dueDate: "2026-08-03",
        descriptionPreview: "Investigate the failure",
      },
      comments: [{ id: "10", bodyPreview: "First finding" }],
      changelogEntries: [{ id: "11", changes: ["status: To Do -> Done"] }],
      remoteLinks: [{ id: "12", url: "https://example.com/run" }],
    });
    assert.equal(jira.success, true);

    const confluence = confluenceResultDetailsSchema.safeParse({
      page: {
        id: "20",
        bodyPreview: "Deployment steps",
        webUrl: "https://example.atlassian.net/wiki/spaces/SD/pages/20",
      },
      childPages: [{ id: "21", title: "Child" }],
      properties: [{ id: "22", key: "owner", valuePreview: "Platform" }],
    });
    assert.equal(confluence.success, true);
  });

  it("rejects unbounded preview fields", () => {
    const parsed = jiraResultDetailsSchema.safeParse({
      issue: { key: "NER-14", descriptionPreview: "x".repeat(501) },
    });
    assert.equal(parsed.success, false);
  });

  it("accepts lifecycle resources while preserving future fields", () => {
    const parsed = confluenceResultDetailsSchema.safeParse({
      action: "manage_restriction",
      operation: "add",
      pageId: "10420227",
      restrictionOperation: "read",
      subjectType: "group",
      subjectId: "engineering",
      restrictions: [
        {
          operation: "read",
          subjectType: "group",
          subjectId: "engineering",
        },
      ],
      futureField: "kept",
    });
    assert.equal(parsed.success, true);
    if (!parsed.success) return;
    assert.equal(parsed.data.futureField, "kept");
  });
});
