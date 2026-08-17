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
