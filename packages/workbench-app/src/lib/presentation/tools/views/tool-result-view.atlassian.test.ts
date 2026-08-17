import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toolPresentation } from "./tool-presentation";
import { parseToolView } from "./tool-result-view";
import { toolCall } from "./tool-result-view.fixtures";

function result(details: Record<string, unknown>) {
  return { content: "executor prose must not drive the compact view", details };
}

describe("normalized Atlassian tool views", () => {
  it("parses Jira board collections and computes structured expansion labels", () => {
    const call = toolCall(
      "jira_search_boards",
      { project_key: "NER", board_type: "scrum" },
      result({
        action: "search_boards",
        boardCount: 5,
        boards: [
          { id: "34", name: "NER board", type: "scrum", projectKey: "NER" },
          { id: "35", name: "Platform", type: "scrum", projectKey: "NER" },
          { id: "36", name: "Release", type: "scrum", projectKey: "NER" },
          { id: "37", name: "Ops", type: "scrum", projectKey: "NER" },
          { id: "38", name: "Docs", type: "scrum", projectKey: "NER" },
        ],
      }),
    );
    const view = parseToolView(call);
    assert.equal(view.kind, "jira");
    if (view.kind !== "jira") return;
    assert.equal(view.action, "search_boards");
    assert.equal(view.boards[0]?.name, "NER board");
    assert.equal(view.query, "project NER · scrum");

    const presentation = toolPresentation(view, call);
    assert.equal(presentation.primaryArg?.text, "project NER · scrum");
    assert.equal(presentation.detailsAction?.label, "Show 2 more boards");
    assert.equal(presentation.detailsAction?.label.includes("lines"), false);
  });

  it("parses a Jira board with promoted sprint and backlog summaries", () => {
    const view = parseToolView(
      toolCall(
        "jira_get_board",
        { board_id: "34", include_sprints: true, include_backlog: true },
        result({
          action: "get_board",
          boardId: "34",
          board: { id: "34", name: "NER board", type: "scrum" },
          sprints: [{ id: "8", name: "August", state: "active" }],
          sprintCount: 1,
          backlogIssues: [{ key: "NER-18", summary: "Smoke test" }],
          backlogCount: 1,
        }),
      ),
    );
    assert.equal(view.kind, "jira");
    if (view.kind !== "jira") return;
    assert.equal(view.board?.name, "NER board");
    assert.equal(view.sprints[0]?.state, "active");
    assert.equal(view.backlogIssues[0]?.key, "NER-18");
  });

  it("keeps rich agent previews out of compact Atlassian presentation metadata", () => {
    const jiraCall = toolCall(
      "jira_get_issue",
      { issue_key: "NER-14", include_comments: true },
      result({
        issue: {
          key: "NER-14",
          summary: "Broken build",
          descriptionPreview: "Long agent-facing issue description",
        },
        comments: [{ id: "10", bodyPreview: "Long agent-facing comment body" }],
        includedCounts: { comments: 1 },
      }),
    );
    const jiraView = parseToolView(jiraCall);
    assert.equal(jiraView.kind, "jira");
    assert.doesNotMatch(
      JSON.stringify(toolPresentation(jiraView, jiraCall)),
      /Long agent-facing/,
    );

    const confluenceCall = toolCall(
      "confluence_get_page",
      { page_id: "20", include_properties: true },
      result({
        page: {
          id: "20",
          title: "Runbook",
          bodyPreview: "Long agent-facing page body",
        },
        properties: [
          { id: "30", key: "owner", valuePreview: "Long property value" },
        ],
        includedCounts: { properties: 1 },
      }),
    );
    const confluenceView = parseToolView(confluenceCall);
    assert.equal(confluenceView.kind, "confluence");
    assert.doesNotMatch(
      JSON.stringify(toolPresentation(confluenceView, confluenceCall)),
      /Long agent-facing|Long property/,
    );
  });

  it("parses Jira resource mutation outcomes from request and result identity", () => {
    const cases = [
      [
        "jira_manage_worklog",
        { action: "delete", issue_key: "NER-1", worklog_id: "9" },
        {
          action: "manage_worklog",
          operation: "delete",
          issueKey: "NER-1",
          worklogId: "9",
        },
      ],
      [
        "jira_manage_issue_link",
        {
          action: "create",
          issue_key: "NER-1",
          other_issue_key: "NER-2",
          link_type: "Blocks",
          direction: "outward",
        },
        {
          action: "manage_issue_link",
          operation: "create",
          issueKey: "NER-1",
          otherIssueKey: "NER-2",
          linkType: "Blocks",
          direction: "outward",
        },
      ],
      [
        "jira_manage_sprint",
        { action: "start", sprint_id: "8" },
        {
          action: "manage_sprint",
          operation: "start",
          sprintId: "8",
          resultingState: "active",
        },
      ],
      [
        "jira_manage_backlog",
        { action: "rank", issue_key: "NER-1", rank_before_issue_key: "NER-2" },
        {
          action: "manage_backlog",
          operation: "rank",
          issueKey: "NER-1",
          rankBeforeIssueKey: "NER-2",
        },
      ],
    ] as const;

    for (const [name, args, details] of cases) {
      const view = parseToolView(toolCall(name, args, result(details)));
      assert.equal(view.kind, "jira");
      if (view.kind !== "jira") continue;
      assert.equal(view.operation, args.action);
    }
  });

  it("parses every Confluence lifecycle result as structured metadata", () => {
    const cases = [
      [
        "confluence_manage_comment",
        { action: "resolve", kind: "inline", comment_id: "10" },
        {
          action: "resolve",
          operation: "resolve",
          kind: "inline",
          commentId: "10",
          comment: { id: "10", kind: "inline", resolutionStatus: "resolved" },
        },
      ],
      [
        "confluence_manage_page",
        { action: "trash", page_id: "20" },
        {
          action: "trash",
          operation: "trash",
          pageId: "20",
          previousStatus: "current",
          resultingStatus: "trashed",
        },
      ],
      [
        "confluence_manage_label",
        { action: "add", page_id: "20", label: "ready" },
        {
          action: "add",
          operation: "add",
          pageId: "20",
          label: "ready",
          labels: [{ name: "ready", prefix: "global" }],
          labelCount: 1,
        },
      ],
      [
        "confluence_manage_restriction",
        {
          action: "add",
          page_id: "20",
          operation: "read",
          subject_type: "group",
          subject_id: "eng",
        },
        {
          action: "add",
          operation: "add",
          pageId: "20",
          restrictionOperation: "read",
          subjectType: "group",
          subjectId: "eng",
          restrictions: [
            { operation: "read", subjectType: "group", subjectId: "eng" },
          ],
          restrictionCount: 1,
        },
      ],
      [
        "confluence_manage_attachment",
        {
          action: "rename",
          page_id: "20",
          attachment_id: "30",
          new_filename: "new.txt",
        },
        {
          action: "rename",
          operation: "rename",
          pageId: "20",
          attachmentId: "30",
          filename: "new.txt",
        },
      ],
    ] as const;

    for (const [name, args, details] of cases) {
      const call = toolCall(name, args, result(details));
      const view = parseToolView(call);
      assert.equal(view.kind, "confluence");
      if (view.kind !== "confluence") continue;
      assert.equal(view.operation, args.action);
      assert.equal(toolPresentation(view, call).detailsAction, undefined);
    }
  });
});
