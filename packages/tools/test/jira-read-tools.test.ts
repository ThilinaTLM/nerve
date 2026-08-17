import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { JiraConnection } from "../src/execution/jira/client.js";
import { searchJiraUsers } from "../src/execution/jira/helpers.js";
import {
  executeJiraGetIssue,
  executeJiraGetProject,
  executeJiraSearchBoards,
  executeJiraSearchIssues,
} from "../src/execution/jira/jira.js";

const connection: JiraConnection = {
  siteUrl: "https://example.atlassian.net",
  email: "developer@example.com",
  token: "secret-token",
};

const context = {
  cwd: process.cwd(),
  getApiKey: async () => "secret-token",
  getProviderConfig: async () => ({
    enabled: true,
    siteUrl: connection.siteUrl,
    email: connection.email,
  }),
};

describe("Jira read request contracts", () => {
  it("returns board ids in agent-visible search rows", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      Response.json({
        values: Array.from({ length: 21 }, (_, index) => ({
          id: 34 + index,
          name: index === 0 ? "NER board" : `Board ${index + 1}`,
          type: "scrum",
          location: { projectKey: "NER" },
        })),
        total: 21,
        isLast: true,
      });
    try {
      const result = await executeJiraSearchBoards(
        { project_key: "NER", save_to_file: false },
        context,
      );
      assert.match(
        result.content ?? "",
        /- 34 · NER board · scrum · project NER/,
      );
      assert.match(result.content ?? "", /Showing first 20 of 21 boards/);
      assert.doesNotMatch(result.content ?? "", /- 54 ·/);
      assert.equal(
        (result.details?.boards as Array<{ id?: string }> | undefined)?.[0]?.id,
        "34",
      );
      assert.equal(result.details?.displayedBoardCount, 20);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns issue-type identities and focused create fields inline", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/issuetypes/10039")) {
        return Response.json({
          fields: {
            summary: {
              fieldId: "summary",
              name: "Summary",
              required: true,
              schema: { type: "string" },
            },
          },
        });
      }
      return Response.json({
        key: "NER",
        name: "Nerve",
        issueTypes: [
          { id: "10039", name: "Bug", subtask: false, hierarchyLevel: 0 },
          { id: "10038", name: "Sub-task", subtask: true, hierarchyLevel: -1 },
        ],
      });
    };
    try {
      const discovery = await executeJiraGetProject(
        {
          project_key: "NER",
          include_issue_types: true,
          save_to_file: false,
        },
        context,
      );
      assert.match(discovery.content ?? "", /- 10039 · Bug · hierarchy 0/);
      assert.match(
        discovery.content ?? "",
        /- 10038 · Sub-task · subtask · hierarchy -1/,
      );
      assert.equal(
        (discovery.details?.issueTypes as unknown[] | undefined)?.length,
        2,
      );

      const createMeta = await executeJiraGetProject(
        {
          project_key: "NER",
          include_create_meta: true,
          issue_type_name: "Bug",
          save_to_file: false,
        },
        context,
      );
      assert.match(
        createMeta.content ?? "",
        /- summary · Summary · string · required/,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("selects documented user-search scopes without a fabricated transition id", async () => {
    const originalFetch = globalThis.fetch;
    const requests: URL[] = [];
    globalThis.fetch = async (input) => {
      requests.push(new URL(String(input)));
      return Response.json([]);
    };
    try {
      await searchJiraUsers(connection, {
        query: "Ari",
        issueKey: "NER-1",
        projectKey: "NER",
        maxResults: 10,
      });
      await searchJiraUsers(connection, {
        query: "Ari",
        projectKey: "NER",
        maxResults: 10,
      });
      await searchJiraUsers(connection, {
        query: "Ari",
        maxResults: 10,
        includeInactive: true,
      });

      assert.equal(requests[0]?.pathname, "/rest/api/3/user/assignable/search");
      assert.equal(requests[0]?.searchParams.get("issueKey"), "NER-1");
      assert.equal(requests[0]?.searchParams.has("actionDescriptorId"), false);
      assert.equal(requests[1]?.searchParams.get("project"), "NER");
      assert.equal(requests[1]?.searchParams.has("actionDescriptorId"), false);
      assert.equal(requests[2]?.pathname, "/rest/api/3/user/search");
      assert.equal(requests[2]?.searchParams.get("includeInactive"), "true");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("serializes enhanced-search expansions as one comma-delimited value", async () => {
    const originalFetch = globalThis.fetch;
    let requestBody: Record<string, unknown> | undefined;
    globalThis.fetch = async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({ issues: [] });
    };
    try {
      await executeJiraSearchIssues(
        {
          jql: "project = NER",
          expand: [" names ", "schema", "names"],
          next_page_token: "next-1",
          save_to_file: false,
        },
        context,
      );
      assert.equal(requestBody?.expand, "names,schema");
      assert.equal(requestBody?.nextPageToken, "next-1");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns bounded readable issue previews with follow-up identities", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/issue/NER-14/comment")) {
        return Response.json({
          comments: Array.from({ length: 4 }, (_, index) => ({
            id: `c${index + 1}`,
            author: { displayName: "Ari" },
            body: {
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: `Comment ${index + 1}` }],
                },
              ],
            },
          })),
        });
      }
      if (url.pathname.endsWith("/issue/NER-14/worklog")) {
        return Response.json({
          worklogs: [{ id: "w1", timeSpent: "1h", comment: "Investigated" }],
        });
      }
      if (url.pathname.endsWith("/issue/NER-14/changelog")) {
        return Response.json({
          values: [
            {
              id: "h1",
              items: [
                { field: "status", fromString: "To Do", toString: "Done" },
              ],
            },
          ],
        });
      }
      if (url.pathname.endsWith("/issue/NER-14/remotelink")) {
        return Response.json([
          {
            id: "r1",
            object: { title: "Build", url: "https://ci.example/1" },
          },
        ]);
      }
      if (url.searchParams.get("fields") === "issuelinks") {
        return Response.json({
          key: "NER-14",
          fields: {
            issuelinks: [
              {
                id: "l1",
                type: { name: "Blocks" },
                outwardIssue: { key: "NER-15" },
              },
            ],
          },
        });
      }
      return Response.json({
        id: "14",
        key: "NER-14",
        fields: {
          summary: "Broken build",
          created: "2026-08-01T00:00:00Z",
          duedate: "2026-08-20",
          description: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "Investigate deployment" }],
              },
            ],
          },
          attachment: [{ id: "a1", filename: "trace.txt", size: 42 }],
        },
      });
    };
    try {
      const result = await executeJiraGetIssue(
        {
          issue_key: "NER-14",
          include_comments: true,
          include_worklogs: true,
          include_changelog: true,
          include_remote_links: true,
          include_issue_links: true,
          include_attachments: true,
          save_to_file: false,
        },
        context,
      );
      assert.match(result.content ?? "", /Description: Investigate deployment/);
      assert.match(result.content ?? "", /Showing first 3 of 4/);
      assert.match(result.content ?? "", /a1 · trace.txt/);
      assert.match(result.content ?? "", /NER-15/);
      assert.match(result.content ?? "", /https:\/\/ci\.example\/1/);
      assert.equal(
        (result.details?.comments as unknown[] | undefined)?.length,
        3,
      );
      assert.equal(result.details?.includedCounts?.comments, 4);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
