import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  confluenceBanner,
  confluenceEmptyMessage,
  hasStructuredConfluence,
  hasStructuredJira,
  jiraBanner,
  jiraEmptyMessage,
} from "./atlassian-view-body";
import { toolCall } from "./tool-result-view.fixtures";
import { parseToolView } from "./tool-result-view";
import type { ToolCallRecord } from "../../state/tool-types";
import type { ToolView } from "./tool-view-types";

type JiraView = Extract<ToolView, { kind: "jira" }>;
type ConfluenceView = Extract<ToolView, { kind: "confluence" }>;

function jiraView(
  toolName: ToolCallRecord["toolName"],
  args: Record<string, unknown>,
  details: Record<string, unknown>,
): JiraView {
  const view = parseToolView(toolCall(toolName, args, { details }));
  assert.equal(view.kind, "jira");
  return view as JiraView;
}

function confluenceView(
  toolName: ToolCallRecord["toolName"],
  args: Record<string, unknown>,
  details: Record<string, unknown>,
): ConfluenceView {
  const view = parseToolView(toolCall(toolName, args, { details }));
  assert.equal(view.kind, "confluence");
  return view as ConfluenceView;
}

describe("jiraBanner", () => {
  it("summarizes a created issue with tone success", () => {
    const view = jiraView(
      "jira_create_issue",
      { project_key: "NER" },
      { issueKey: "NER-42", summary: "Add rich rendering" },
    );
    const banner = jiraBanner(view, "completed");
    assert.equal(banner?.tone, "success");
    assert.equal(banner?.text, "Created NER-42 · Add rich rendering");
  });

  it("marks dry-run mutations with tone info", () => {
    const view = jiraView(
      "jira_update_issue",
      { issue_key: "NER-7" },
      { issueKey: "NER-7", dryRun: true },
    );
    const banner = jiraBanner(view, "completed");
    assert.equal(banner?.tone, "info");
    assert.match(banner?.text ?? "", /Dry run — would update NER-7/);
  });

  it("counts updated fields", () => {
    const view = jiraView(
      "jira_update_issue",
      { issue_key: "NER-7" },
      { issueKey: "NER-7", updatedFields: ["summary", "labels"] },
    );
    assert.equal(
      jiraBanner(view, "completed")?.text,
      "Updated NER-7 · 2 fields",
    );
  });

  it("summarizes comments and transitions", () => {
    const comment = jiraView(
      "jira_add_comment",
      { issue_key: "NER-7" },
      { issueKey: "NER-7", commentId: "10001" },
    );
    assert.equal(
      jiraBanner(comment, "completed")?.text,
      "Comment added to NER-7 · id 10001",
    );

    const transition = jiraView(
      "jira_transition_issue",
      { issue_key: "NER-7", transition: "Done" },
      { issueKey: "NER-7", transition: { id: "31", name: "Done", to: "Done" } },
    );
    assert.equal(
      jiraBanner(transition, "completed")?.text,
      "Transitioned NER-7",
    );
  });

  it("returns nothing for read actions or non-completed calls", () => {
    const search = jiraView(
      "jira_search_issues",
      { jql: "project = NER" },
      { issues: [{ key: "NER-1" }] },
    );
    assert.equal(jiraBanner(search, "completed"), undefined);

    const create = jiraView(
      "jira_create_issue",
      { project_key: "NER" },
      { issueKey: "NER-42" },
    );
    assert.equal(jiraBanner(create, "error"), undefined);
  });
});

describe("confluenceBanner", () => {
  it("summarizes page mutations", () => {
    const created = confluenceView(
      "confluence_create_page",
      { title: "Runbook" },
      { title: "Runbook", pageId: "123" },
    );
    assert.equal(
      confluenceBanner(created, "completed")?.text,
      'Created page "Runbook"',
    );

    const updated = confluenceView(
      "confluence_update_page",
      { page_id: "123" },
      {
        title: "Runbook",
        page: { id: "123", title: "Runbook", versionNumber: 4 },
      },
    );
    assert.equal(
      confluenceBanner(updated, "completed")?.text,
      'Updated page "Runbook" · v4',
    );
  });

  it("summarizes downloads, publishes, and uploads", () => {
    const downloaded = confluenceView(
      "confluence_download_pages",
      {},
      { pageCount: 3, downloadDir: "/tmp/bundle" },
    );
    assert.equal(
      confluenceBanner(downloaded, "completed")?.text,
      "Downloaded 3 pages",
    );

    const published = confluenceView(
      "confluence_publish_pages",
      {},
      { outcomeCount: 2, dryRun: true, outcomes: [] },
    );
    const publishBanner = confluenceBanner(published, "completed");
    assert.equal(publishBanner?.tone, "info");
    assert.equal(publishBanner?.text, "Dry run — 2 pages");

    const uploaded = confluenceView(
      "confluence_upload_attachment",
      { page_id: "123" },
      { attachment: { filename: "diagram.png" } },
    );
    assert.equal(
      confluenceBanner(uploaded, "completed")?.text,
      "Uploaded diagram.png",
    );
  });
});

describe("empty messages", () => {
  it("reports explicit zero-result searches", () => {
    const issues = jiraView(
      "jira_search_issues",
      { jql: "project = NER" },
      { issueCount: 0, issues: [] },
    );
    assert.equal(jiraEmptyMessage(issues, "completed"), "No issues found.");

    const pages = confluenceView(
      "confluence_search_pages",
      { cql: "type = page" },
      { pageCount: 0, pages: [] },
    );
    assert.equal(confluenceEmptyMessage(pages, "completed"), "No pages found.");
  });

  it("stays silent without an explicit count or before completion", () => {
    const textOnly = jiraView("jira_search_issues", { jql: "x" }, {});
    assert.equal(jiraEmptyMessage(textOnly, "completed"), undefined);

    const running = jiraView(
      "jira_search_issues",
      { jql: "x" },
      { issueCount: 0, issues: [] },
    );
    assert.equal(jiraEmptyMessage(running, "running"), undefined);
  });
});

describe("structured detection", () => {
  it("prefers rich rendering when structured details exist", () => {
    const search = jiraView(
      "jira_search_issues",
      { jql: "project = NER" },
      { issues: [{ key: "NER-1", summary: "One" }] },
    );
    assert.equal(hasStructuredJira(search, "completed"), true);

    const pages = confluenceView(
      "confluence_search_pages",
      { cql: "type = page" },
      { pages: [{ id: "1", title: "Doc" }] },
    );
    assert.equal(hasStructuredConfluence(pages, "completed"), true);
  });

  it("falls back for text-only results", () => {
    const jira = jiraView("jira_search_issues", { jql: "project = NER" }, {});
    assert.equal(hasStructuredJira(jira, "completed"), false);

    const confluence = confluenceView("confluence_search_pages", {}, {});
    assert.equal(hasStructuredConfluence(confluence, "completed"), false);
  });
});
