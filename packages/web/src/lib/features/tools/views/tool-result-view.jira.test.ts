import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toolPresentation } from "./tool-presentation";
import { parseToolView } from "./tool-result-view";
import { metaText, toolCall } from "./tool-result-view.fixtures";

describe("Jira tool views", () => {
  it("parses bounded Jira search details and surfaces header/meta", () => {
    const tc = toolCall(
      "jira_search_issues",
      { jql: "project = NER ORDER BY updated DESC", max_results: 25 },
      {
        content:
          "Jira search returned 2 issues (total 50).\n\n- NER-1 · Bug · To Do — Broken\n- NER-2 · Task · Done — Fixed",
        details: {
          jql: "project = NER ORDER BY updated DESC",
          issueCount: 2,
          displayedIssueCount: 2,
          total: 50,
          issues: [
            {
              key: "NER-1",
              issueType: "Bug",
              status: "To Do",
              summary: "Broken",
            },
            {
              key: "NER-2",
              issueType: "Task",
              status: "Done",
              summary: "Fixed",
            },
          ],
          outputLimits: {
            artifacts: [
              {
                kind: "raw_result",
                path: "/tmp/jira/search.json",
                label: "Raw Jira JSON",
              },
            ],
          },
        },
      },
    );

    const view = parseToolView(tc);
    assert.equal(view.kind, "jira");
    if (view.kind !== "jira") return;
    assert.equal(view.action, "search_issues");
    assert.equal(view.issues.length, 2);
    assert.equal(view.total, 50);

    const presentation = toolPresentation(view, tc);
    assert.equal(presentation.badge, "jira_search_issues");
    assert.equal(
      presentation.primaryArg?.text,
      "project = NER ORDER BY updated DESC",
    );
    assert.deepEqual(metaText(presentation.meta), [
      "2 issues",
      "50 total",
      "raw result",
    ]);
    assert.equal(presentation.meta.at(-1)?.openPath, "/tmp/jira/search.json");
  });

  it("falls back to historical Jira text output for issue and transitions", () => {
    const view = parseToolView(
      toolCall(
        "jira_get_issue",
        { issue_key: "NER-7" },
        {
          content: [
            "- NER-7 · Story · In Progress · assignee: Jane Doe — Add Jira rendering",
            "Comments: 3",
            "Available transitions:",
            "- 21 · Done → Done",
            "Raw JSON saved to: /tmp/jira/get.json",
          ].join("\n"),
          details: { issueKey: "NER-7" },
        },
      ),
    );

    assert.equal(view.kind, "jira");
    if (view.kind !== "jira") return;
    assert.equal(view.issueKey, "NER-7");
    assert.equal(view.issues[0]?.summary, "Add Jira rendering");
    assert.equal(view.issues[0]?.assignee, "Jane Doe");
    assert.equal(view.transitions[0]?.name, "Done");
    assert.equal(view.includedCounts?.comments, 3);

    const presentation = toolPresentation(
      view,
      toolCall("jira_get_issue", {}, {}),
    );
    assert.equal(presentation.primaryArg?.text, "NER-7");
    assert.ok(metaText(presentation.meta).includes("3 comments"));
  });

  it("presents project include counts and update field counts", () => {
    const project = toolPresentation(
      parseToolView(
        toolCall(
          "jira_get_project",
          { project_key: "NER", include_statuses: true },
          {
            content: "Jira project NER: Nerve\nstatuses: 12\ncomponents: 4",
            details: {
              projectKey: "NER",
              project: {
                key: "NER",
                name: "Nerve",
                projectTypeKey: "software",
              },
              includedCounts: { statuses: 12, components: 4 },
            },
          },
        ),
      ),
      toolCall("jira_get_project", {}, {}),
    );
    assert.equal(project.primaryArg?.text, "NER · Nerve");
    assert.deepEqual(metaText(project.meta), [
      "software",
      "12 statuses",
      "4 components",
    ]);

    const update = toolPresentation(
      parseToolView(
        toolCall(
          "jira_update_issue",
          { issue_key: "NER-1" },
          {
            details: {
              issueKey: "NER-1",
              updatedFields: ["summary", "priority"],
              updatedFieldCount: 2,
            },
          },
        ),
      ),
      toolCall("jira_update_issue", {}, {}),
    );
    assert.equal(update.primaryArg?.text, "NER-1");
    assert.deepEqual(metaText(update.meta), ["2 fields updated"]);
  });

  it("surfaces authoritative status category on parsed issues", () => {
    const tc = toolCall(
      "jira_search_issues",
      { jql: "project = NER" },
      {
        details: {
          jql: "project = NER",
          issueCount: 1,
          issues: [
            {
              key: "NER-1",
              issueType: "Bug",
              status: "In Progress",
              statusCategory: "indeterminate",
              summary: "Broken",
            },
          ],
        },
      },
    );
    const view = parseToolView(tc);
    assert.equal(view.kind, "jira");
    if (view.kind !== "jira") return;
    assert.equal(view.issues[0]?.statusCategory, "indeterminate");
  });

  it("parses dry-run create details and adds a preview chip", () => {
    const tc = toolCall(
      "jira_create_issue",
      { project_key: "NER", issue_type: "Task", summary: "New" },
      {
        content: "Dry run: Jira issue would be created in NER.",
        details: {
          dryRun: true,
          projectKey: "NER",
          issueType: "Task",
          summary: "New",
          resolvedAssignee: { accountId: "acc-1", displayName: "Jane Doe" },
        },
      },
    );
    const view = parseToolView(tc);
    assert.equal(view.kind, "jira");
    if (view.kind !== "jira") return;
    assert.equal(view.dryRun, true);
    assert.equal(view.resolvedAssignee?.displayName, "Jane Doe");

    const presentation = toolPresentation(view, tc);
    assert.ok(metaText(presentation.meta).includes("preview"));
  });

  it("offers details when inline Jira rows exceed the collapsed body", () => {
    const issues = Array.from({ length: 12 }, (_, index) => ({
      key: `NER-${index + 1}`,
      summary: `Issue ${index + 1}`,
    }));
    const tc = toolCall(
      "jira_search_issues",
      { jql: "project = NER" },
      { details: { jql: "project = NER", issueCount: 12, issues } },
    );
    const presentation = toolPresentation(parseToolView(tc), tc);

    assert.equal(presentation.detailsAction?.hidden, 2);
    assert.match(presentation.detailsAction?.label ?? "", /2 more issues/);
  });
});
