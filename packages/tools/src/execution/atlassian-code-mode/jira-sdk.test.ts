import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { codeModeResultDetailsSchema } from "@nervekit/contracts/tools";
import { ToolExecutionError } from "../errors/tool-error.js";
import { executeAtlassianCodeMode } from "./atlassian-code-mode.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function context(
  authorized: Array<{ toolName: string; args: Record<string, unknown> }> = [],
) {
  return {
    cwd: process.cwd(),
    getApiKey: async () => "token",
    getProviderConfig: async () => ({
      enabled: true,
      siteUrl: "https://example.atlassian.net",
      email: "dev@example.com",
    }),
    authorizeNested: async (request: {
      toolName: string;
      args: Record<string, unknown>;
    }) => {
      authorized.push(request);
    },
  };
}

const adf = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

void test("every method takes one ID string or one options object, with one ID name", async () => {
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.includes("/project/")) {
      return Response.json({
        key: "SCRUM",
        name: "Scrum",
        issueTypes: [{ name: "Task" }],
      });
    }
    return Response.json({ id: "4", key: "SCRUM-4", fields: { summary: "S" } });
  };
  const authorized: Array<{
    toolName: string;
    args: Record<string, unknown>;
  }> = [];
  const result = await executeAtlassianCodeMode(
    {
      code: `
        const p = await jira.projects.get({ key: "SCRUM" });
        const i = await jira.issues.get({ key: "SCRUM-4", fields: ["summary"] });
        const j = await jira.issues.get("SCRUM-4");
        console.log(p.key, i.key, j.summary);
        const attempts = [
          () => jira.issues.get({ issueKey: "SCRUM-4" }),
          () => jira.issues.get("SCRUM-4", { fields: ["summary"] }),
          () => jira.projects.get({}),
        ];
        for (const attempt of attempts) {
          try { await attempt(); } catch (e) { console.log(e.name + ": " + e.message); }
        }
      `,
    },
    context(authorized),
  );
  const lines = (result.content ?? "").split("\n");
  assert.equal(lines[0], "SCRUM SCRUM-4 S");
  assert.equal(
    lines[1],
    "HostError: jira.issues.get has no option 'issueKey'; valid options: key, fields, comments.",
  );
  assert.equal(
    lines[2],
    "HostError: jira.issues.get takes one argument (a key string or an options object), got 2.",
  );
  assert.equal(lines[3], "HostError: key must be a non-empty string.");
  assert.deepEqual(
    authorized.map((r) => r.args),
    [
      { project_key: "SCRUM" },
      { issue_key: "SCRUM-4" },
      { issue_key: "SCRUM-4" },
    ],
  );
});

void test("maps parent for subtasks and simplifies structured fields", async () => {
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (!url.searchParams.get("fields")!.includes("comment")) {
      assert.match(url.searchParams.get("fields") ?? "", /parent/);
    }
    return Response.json({
      id: "4",
      key: "SCRUM-4",
      fields: {
        summary: "Subtask 2.1",
        parent: { key: "SCRUM-2", fields: { summary: "Parent" } },
        comment: {
          comments: [
            {
              author: { displayName: "Ann", accountId: "a" },
              created: "2026-01-01",
              body: adf("hi **there**"),
            },
          ],
        },
        attachment: [
          {
            id: "9",
            filename: "a.png",
            size: 12,
            mimeType: "image/png",
            content: "https://x",
          },
        ],
        issuelinks: [
          {
            type: { name: "Blocks" },
            outwardIssue: { key: "SCRUM-9", fields: { summary: "Other" } },
          },
          {
            type: { name: "Blocks" },
            inwardIssue: { key: "SCRUM-1", fields: { summary: "First" } },
          },
        ],
        subtasks: [
          {
            key: "SCRUM-5",
            fields: { summary: "Kid", status: { name: "Done" } },
          },
        ],
      },
    });
  };
  const result = await executeAtlassianCodeMode(
    {
      code: `
        const d = await jira.issues.get("SCRUM-4");
        const x = await jira.issues.get({ key: "SCRUM-4", fields: ["summary", "comment", "attachment", "issuelinks", "subtasks"] });
        console.log(JSON.stringify([d.parent, x]));
      `,
    },
    context(),
  );
  const [parent, issue] = JSON.parse((result.content ?? "").split("\n")[0]) as [
    unknown,
    Record<string, unknown>,
  ];
  assert.deepEqual(parent, { key: "SCRUM-2", summary: "Parent" });
  assert.deepEqual(issue.comment, [
    { author: "Ann", created: "2026-01-01", body: "hi **there**" },
  ]);
  assert.deepEqual(issue.attachment, [
    { id: "9", filename: "a.png", size: 12, mimeType: "image/png" },
  ]);
  assert.deepEqual(issue.issuelinks, [
    { type: "Blocks", direction: "outward", key: "SCRUM-9", summary: "Other" },
    { type: "Blocks", direction: "inward", key: "SCRUM-1", summary: "First" },
  ]);
  assert.deepEqual(issue.subtasks, [
    { key: "SCRUM-5", summary: "Kid", status: "Done" },
  ]);
});

void test("strips the skill guide pointer from Jira errors", async () => {
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ errorMessages: ["Unbounded JQL"] }), {
      status: 400,
    });
  const result = await executeAtlassianCodeMode(
    {
      code: `try { await jira.issues.search({ jql: "ORDER BY created" }); } catch (e) { console.log(e.message); }`,
    },
    context(),
  );
  assert.doesNotMatch(result.content ?? "", /SKILL\.md/);
  const details = codeModeResultDetailsSchema.parse(result.details);
  assert.equal(details.hostCalls[0].outcome, "failed");
  assert.doesNotMatch(details.hostCalls[0].error ?? "", /SKILL\.md/);
});

void test("denials keep the policy reason", async () => {
  const ctx = {
    ...context(),
    authorizeNested: async () => {
      throw new ToolExecutionError("NESTED_DENIED", "nope");
    },
  };
  const result = await executeAtlassianCodeMode(
    {
      code: `try { await jira.users.search({ query: "ann" }); } catch (e) { console.log(e.message); }`,
    },
    ctx,
  );
  assert.match(result.content ?? "", /^nope/);
});
