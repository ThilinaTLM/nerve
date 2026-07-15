import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ConversationLiveToolDraftBlockSnapshot } from "@nervekit/contracts";
import {
  confluenceDraftSummaryBody,
  confluenceToolSummaryBody,
  jiraDraftSummaryBody,
  jiraToolSummaryBody,
} from "./atlassian-tool-summary";
import { toolPresentation } from "./tool-presentation";
import { parseToolView } from "./tool-result-view";
import { toolCall } from "./tool-result-view.fixtures";

function draft(
  toolName: string,
  overrides: Partial<ConversationLiveToolDraftBlockSnapshot> = {},
): ConversationLiveToolDraftBlockSnapshot {
  return {
    kind: "tool_call_draft",
    contentBlockId: "block_1",
    contentIndex: 0,
    providerToolCallId: "call_1",
    toolName,
    argsText: "",
    done: false,
    ...overrides,
  };
}

describe("Atlassian tool summaries", () => {
  it("renders readable Jira create issue approval details from args", () => {
    const tc = toolCall(
      "jira_create_issue",
      {
        project_key: "NER",
        issue_type: "Task",
        summary: "Example dependency demo: UI integration",
        labels: ["nerve-example", "linked-demo"],
        description_adf: {
          type: "doc",
          version: 1,
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "Build the UI integration task." },
              ],
            },
          ],
        },
      },
      undefined,
      { status: "pending_approval", risk: "command" },
    );
    const view = parseToolView(tc);
    assert.equal(view.kind, "jira");
    if (view.kind !== "jira") return;

    const body = jiraToolSummaryBody(tc, view);
    assert.match(body, /Review Jira create issue/);
    assert.match(body, /Project: NER/);
    assert.match(body, /Type: Task/);
    assert.match(body, /Summary: Example dependency demo/);
    assert.match(body, /Description: Build the UI integration task\./);
    assert.match(body, /Labels: nerve-example, linked-demo/);
    assert.match(body, /Mode: will create issue/);
    assert.doesNotMatch(body, /description_adf/);
  });

  it("summarizes Jira user search results and exposes the query as primary arg", () => {
    const tc = toolCall(
      "jira_search_users",
      { query: "alex", project_key: "NER", max_results: 10 },
      {
        content: "Jira user search returned 1 user.",
        details: {
          query: "alex",
          projectKey: "NER",
          userCount: 1,
          users: [
            {
              accountId: "acc-1",
              displayName: "Alex Doe",
              emailAddress: "alex@example.test",
              active: true,
            },
          ],
        },
      },
    );
    const view = parseToolView(tc);
    assert.equal(view.kind, "jira");
    if (view.kind !== "jira") return;
    assert.equal(view.query, "alex");
    assert.equal(toolPresentation(view, tc).primaryArg?.text, "alex");

    const body = jiraToolSummaryBody(tc, view);
    assert.match(body, /Completed Jira search users/);
    assert.match(body, /Returned: 1 user/);
    assert.match(body, /Alex Doe <alex@example\.test> · acc-1/);
  });

  it("distinguishes Jira transition discovery from mutation", () => {
    const pending = toolCall(
      "jira_transition_issue",
      { issue_key: "NER-7" },
      undefined,
      { status: "pending_approval", risk: "command" },
    );
    const pendingView = parseToolView(pending);
    assert.equal(pendingView.kind, "jira");
    if (pendingView.kind !== "jira") return;
    const pendingBody = jiraToolSummaryBody(pending, pendingView);
    assert.match(pendingBody, /Transition: list available transitions/);
    assert.doesNotMatch(pendingBody, /Mode: will transition issue/);

    const completed = toolCall(
      "jira_transition_issue",
      { issue_key: "NER-7" },
      {
        details: {
          issueKey: "NER-7",
          transitions: [{ id: "21", name: "Done", to: "Done" }],
          transitionCount: 1,
        },
      },
    );
    const completedView = parseToolView(completed);
    assert.equal(completedView.kind, "jira");
    if (completedView.kind !== "jira") return;
    const completedBody = jiraToolSummaryBody(completed, completedView);
    assert.match(completedBody, /Available: 1 transition/);
    assert.match(completedBody, /21 · Done · → Done/);
  });

  it("renders readable Confluence create page approval details", () => {
    const tc = toolCall(
      "confluence_create_page",
      {
        space_key: "DOC",
        title: "Release Notes",
        body: "## Release\nShip the readable body summary.",
        body_representation: "storage",
        dry_run: true,
      },
      undefined,
      { status: "pending_approval", risk: "command" },
    );
    const view = parseToolView(tc);
    assert.equal(view.kind, "confluence");
    if (view.kind !== "confluence") return;

    const body = confluenceToolSummaryBody(tc, view);
    assert.match(body, /Review Confluence create page/);
    assert.match(body, /Space: DOC/);
    assert.match(body, /Title: Release Notes/);
    assert.match(body, /Body:/);
    assert.match(body, /Ship the readable body summary\./);
    assert.match(body, /Mode: dry run \/ no mutation/);
  });

  it("summarizes Confluence publish outcomes", () => {
    const tc = toolCall(
      "confluence_publish_pages",
      { input_path: "/tmp/pages.jsonl" },
      {
        details: {
          action: "publish_pages",
          inputPath: "/tmp/pages.jsonl",
          outcomes: [
            {
              index: 0,
              operation: "update",
              id: "123",
              title: "Home",
              status: "updated",
            },
            { index: 1, operation: "create", title: "New", status: "created" },
            {
              index: 2,
              operation: "create",
              title: "Skipped",
              status: "skipped",
            },
          ],
          outcomeCount: 3,
        },
      },
    );
    const view = parseToolView(tc);
    assert.equal(view.kind, "confluence");
    if (view.kind !== "confluence") return;

    const body = confluenceToolSummaryBody(tc, view);
    assert.match(body, /Completed Confluence publish pages/);
    assert.match(body, /Processed: 3 outcomes/);
    assert.match(body, /Outcome statuses: 1 updated, 1 created, 1 skipped/);
    assert.match(body, /#0 · update · 123 · "Home" · updated/);
  });

  it("surfaces Confluence search next cursors", () => {
    const tc = toolCall(
      "confluence_search_pages",
      { cql: "type = page" },
      {
        details: {
          action: "search_pages",
          cql: "type = page",
          pages: [{ id: "123", title: "Home", spaceKey: "DOC" }],
          pageCount: 1,
          nextCursor: "cursor-2",
        },
      },
    );
    const view = parseToolView(tc);
    assert.equal(view.kind, "confluence");
    if (view.kind !== "confluence") return;
    assert.equal(view.nextCursor, "cursor-2");
    assert.match(confluenceToolSummaryBody(tc, view), /Next cursor: cursor-2/);
  });

  it("renders Jira and Confluence draft summaries without raw JSON", () => {
    const jiraBody = jiraDraftSummaryBody(
      draft("jira_create_issue", {
        argsText:
          '{"project_key":"NER","issue_type":"Task","summary":"Create readable summaries"',
      }),
    );
    assert.ok(jiraBody);
    assert.match(jiraBody, /Preparing Jira create issue/);
    assert.match(jiraBody, /Project: NER/);
    assert.match(jiraBody, /Summary: Create readable summaries/);
    assert.doesNotMatch(jiraBody, /project_key/);

    const confluenceBody = confluenceDraftSummaryBody(
      draft("confluence_update_page", {
        args: {
          page_id: "123",
          body: "Updated storage body",
          dry_run: true,
        },
        done: true,
      }),
    );
    assert.ok(confluenceBody);
    assert.match(confluenceBody, /Prepared Confluence update page/);
    assert.match(confluenceBody, /Page: 123/);
    assert.match(confluenceBody, /Body: Updated storage body/);
    assert.match(confluenceBody, /Mode: dry run \/ no mutation/);
  });
});
