import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { executeAtlassianCodeMode } from "./atlassian-code-mode.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

type Sent = {
  method: string;
  path: string;
  query: URLSearchParams;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
};
type Nested = { toolName: string; args: Record<string, unknown> };

const FIELDS = [
  { id: "summary", name: "Summary", custom: false, schema: { type: "string" } },
  {
    id: "description",
    name: "Description",
    custom: false,
    schema: { type: "string" },
  },
  {
    id: "assignee",
    name: "Assignee",
    custom: false,
    schema: { type: "user", system: "assignee" },
  },
  {
    id: "priority",
    name: "Priority",
    custom: false,
    schema: { type: "priority" },
  },
  {
    id: "labels",
    name: "Labels",
    custom: false,
    schema: { type: "array", items: "string" },
  },
  {
    id: "customfield_10016",
    name: "Story Points",
    custom: true,
    schema: { type: "number" },
  },
  {
    id: "customfield_10050",
    name: "Severity",
    custom: true,
    schema: { type: "option" },
  },
  {
    id: "resolution",
    name: "Resolution",
    custom: false,
    schema: { type: "resolution" },
  },
];

const CREATE_FIELDS = [
  {
    fieldId: "summary",
    name: "Summary",
    required: true,
    schema: { type: "string" },
  },
  {
    fieldId: "project",
    name: "Project",
    required: true,
    schema: { type: "project" },
  },
  {
    fieldId: "priority",
    name: "Priority",
    required: false,
    schema: { type: "priority" },
    allowedValues: [{ name: "High" }, { name: "Low" }],
  },
  {
    fieldId: "customfield_10050",
    name: "Severity",
    required: true,
    schema: { type: "option" },
    allowedValues: [{ value: "S1" }, { value: "S2" }],
  },
  {
    fieldId: "customfield_10016",
    name: "Story Points",
    required: false,
    schema: { type: "number" },
  },
  {
    fieldId: "description",
    name: "Description",
    required: false,
    schema: { type: "string" },
  },
  {
    fieldId: "assignee",
    name: "Assignee",
    required: false,
    schema: { type: "user" },
  },
  {
    fieldId: "labels",
    name: "Labels",
    required: false,
    schema: { type: "array", items: "string" },
  },
];

const TRANSITIONS = [
  { id: "11", name: "Start", to: { name: "In Progress" }, fields: {} },
  {
    id: "31",
    name: "Finish",
    to: { name: "Done" },
    fields: {
      resolution: {
        name: "Resolution",
        required: true,
        schema: { type: "resolution" },
        allowedValues: [{ name: "Done" }, { name: "Won't Do" }],
      },
    },
  },
];

function setup(extra?: (sent: Sent) => Response | undefined) {
  const sent: Sent[] = [];
  const authorized: Nested[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const entry: Sent = {
      method: init?.method ?? "GET",
      path: url.pathname.replace("/rest/api/3", ""),
      query: url.searchParams,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body,
    };
    sent.push(entry);
    const custom = extra?.(entry);
    if (custom) return custom;
    const { method, path } = entry;
    if (path === "/field") return Response.json(FIELDS);
    if (path === "/issue/createmeta/APP/issuetypes")
      return Response.json({
        issueTypes: [
          { id: "1", name: "Bug", subtask: false },
          { id: "2", name: "Task", subtask: false },
        ],
      });
    if (path === "/issue/createmeta/APP/issuetypes/1")
      return Response.json({ fields: CREATE_FIELDS });
    if (path === "/issue/createmeta/APP/issuetypes/2")
      return Response.json({ fields: CREATE_FIELDS.slice(0, 3) });
    if (path === "/user/assignable/search")
      return Response.json([
        {
          accountId: "acc-1",
          displayName: "Ann Lee",
          emailAddress: "ann@example.com",
          active: true,
        },
      ]);
    if (method === "POST" && path === "/issue")
      return Response.json({ id: "10", key: "APP-10" });
    if (path.endsWith("/editmeta"))
      return Response.json({
        fields: {
          priority: {
            name: "Priority",
            schema: { type: "priority" },
            allowedValues: [{ name: "High" }, { name: "Low" }],
          },
          description: { name: "Description", schema: { type: "string" } },
        },
      });
    if (path.endsWith("/transitions") && method === "GET")
      return Response.json({ transitions: TRANSITIONS });
    if (method === "POST" && path.endsWith("/comment"))
      return Response.json({ id: "77" });
    if (method === "POST" && path.endsWith("/worklog"))
      return Response.json({ id: "5", timeSpent: "1h 30m" });
    if (path === "/issueLinkType")
      return Response.json({
        issueLinkTypes: [
          { name: "Blocks", inward: "is blocked by", outward: "blocks" },
        ],
      });
    if (path === "/issue/APP-1/attachments")
      return Response.json([{ id: "9", filename: "n.txt", size: 2 }]);
    return new Response(null, { status: 204 });
  };
  const run = (code: string, cwd = process.cwd()) =>
    executeAtlassianCodeMode(
      { code },
      {
        cwd,
        getApiKey: async () => "token",
        getProviderConfig: async () => ({
          enabled: true,
          siteUrl: "https://example.atlassian.net",
          email: "dev@example.com",
          defaultProjectKey: "APP",
        }),
        authorizeNested: async (request: Nested) => {
          authorized.push(request);
        },
      },
    );
  return { sent, authorized, run };
}

/** The JSON a script returned: everything before the footer line. */
function returned(content: string | undefined) {
  const text = content ?? "";
  return JSON.parse(text.slice(0, text.lastIndexOf("\njira ")));
}

const lastOf = (sent: Sent[], method: string, path: string) =>
  sent.filter((s) => s.method === method && s.path === path).at(-1);

void test("issues.create resolves field names, converts Markdown and users, and authorizes as jira_create_issue", async () => {
  const { sent, authorized, run } = setup();
  const result = await run(`
    return await jira.issues.create({
      type: "bug",
      summary: "Crash on save",
      description: "Steps:\\n\\n- open **file**\\n- save",
      fields: { Severity: "s1", Priority: "high", "Story Points": 3, Assignee: "ann@example.com", Labels: "ui" },
    });
  `);
  assert.match(result.content ?? "", /APP-10/);
  const body = lastOf(sent, "POST", "/issue")!.body.fields;
  assert.deepEqual(body.project, { key: "APP" });
  assert.deepEqual(body.issuetype, { name: "Bug" });
  assert.equal(body.summary, "Crash on save");
  assert.deepEqual(body.customfield_10050, { value: "S1" });
  assert.deepEqual(body.priority, { name: "High" });
  assert.equal(body.customfield_10016, 3);
  assert.deepEqual(body.assignee, { accountId: "acc-1" });
  assert.deepEqual(body.labels, ["ui"]);
  assert.equal(body.description.type, "doc");
  assert.deepEqual(body.description.content[1].content[0].content[0].content, [
    { type: "text", text: "open " },
    { type: "text", text: "file", marks: [{ type: "strong" }] },
  ]);
  assert.deepEqual(authorized[0], {
    toolName: "jira_create_issue",
    args: { issue_type: "bug", summary: "Crash on save" },
  });
});

void test("issues.create lists missing required fields, valid issue types and valid values", async () => {
  const { sent, run } = setup();
  const result = await run(`
    for (const options of [
      { type: "Bug", summary: "x" },
      { type: "Bugg", summary: "x" },
      { type: "Bug", summary: "x", fields: { Severity: "S9" } },
      { type: "Bug", summary: "x", fields: { Nope: 1 } },
    ]) {
      try { await jira.issues.create(options); } catch (e) { console.log(e.message); }
    }
  `);
  const lines = (result.content ?? "").split("\n");
  assert.equal(
    lines[0],
    "Bug in APP also requires: Severity (values: S1, S2). Pass them in fields by name.",
  );
  assert.match(
    lines[1],
    /Unknown issue type "Bugg" in project APP\. Did you mean: "Bug"\? Valid types: Bug, Task\./,
  );
  assert.match(
    lines[2],
    /"S9" is not a valid value for Severity\..*Valid values: S1, S2\./,
  );
  assert.match(lines[3], /Unknown Jira field "Nope"/);
  assert.equal(sent.filter((s) => s.path === "/issue").length, 0);
});

void test("issues.update sends converted fields and validates against the edit screen", async () => {
  const { sent, authorized, run } = setup();
  const result = await run(`
    const ok = await jira.issues.update({ key: "APP-1", fields: { Priority: "low", Description: "**x**" } });
    try { await jira.issues.update({ key: "APP-1", fields: { Priority: "urgent" } }); } catch (e) { console.log(e.message); }
    try { await jira.issues.update({ key: "APP-1", fields: {} }); } catch (e) { console.log(e.message); }
    return ok;
  `);
  const put = sent.find((s) => s.method === "PUT")!;
  assert.equal(put.path, "/issue/APP-1");
  assert.deepEqual(put.body.fields.priority, { name: "Low" });
  assert.equal(
    put.body.fields.description.content[0].content[0].marks[0].type,
    "strong",
  );
  assert.match(result.content ?? "", /"Priority"|Valid values: High, Low\./);
  assert.match(result.content ?? "", /fields must name at least one field/);
  assert.equal(authorized[0].toolName, "jira_update_issue");
  assert.equal(sent.filter((s) => s.method === "PUT").length, 1);
});

void test("issues.transition moves by status name, with required fields and a comment", async () => {
  const { sent, authorized, run } = setup();
  const result = await run(`
    const a = await jira.issues.transition({ key: "APP-1", to: "in progress" });
    const b = await jira.issues.transition({ key: "APP-1", to: "Done", fields: { Resolution: "done" }, comment: "shipped" });
    return [a.status, b.status];
  `);
  assert.match(result.content ?? "", /In Progress/);
  const posts = sent.filter(
    (s) => s.method === "POST" && s.path === "/issue/APP-1/transitions",
  );
  assert.deepEqual(posts[0].body, { transition: { id: "11" } });
  assert.deepEqual(posts[1].body.fields, { resolution: { name: "Done" } });
  assert.equal(posts[1].body.transition.id, "31");
  assert.equal(posts[1].body.update, undefined);
  const comments = sent.filter(
    (s) => s.method === "POST" && s.path === "/issue/APP-1/comment",
  );
  assert.equal(comments.length, 1);
  assert.equal(comments[0].body.body.type, "doc");
  assert.deepEqual(authorized[0], {
    toolName: "jira_transition_issue",
    args: { issue_key: "APP-1", transition: "in progress" },
  });
  assert.ok(
    authorized.some(
      (call) =>
        call.toolName === "jira_manage_comment" &&
        call.args.action === "create",
    ),
  );
});

void test("issues.transition errors list the missing fields and the reachable statuses", async () => {
  const { sent, run } = setup();
  const result = await run(`
    for (const options of [
      { key: "APP-1", to: "Done" },
      { key: "APP-1", to: "Done", fields: { Resolution: "maybe" } },
      { key: "APP-1", to: "Archived" },
    ]) {
      try { await jira.issues.transition(options); } catch (e) { console.log(e.message); }
    }
  `);
  const lines = (result.content ?? "").split("\n");
  assert.equal(
    lines[0],
    `Moving APP-1 to "Done" requires: Resolution (values: Done, Won't Do). Pass them in fields by name.`,
  );
  assert.match(
    lines[1],
    /"maybe" is not a valid value for Resolution\..*Valid values: Done, Won't Do\./,
  );
  assert.equal(
    lines[2],
    `APP-1 cannot move to "Archived". Available: "In Progress" (via "Start"), "Done" (via "Finish").`,
  );
  assert.equal(sent.filter((s) => s.method === "POST").length, 0);
});

void test("comments, worklogs, links and sprint moves send the REST shapes and authorize as the manage tools", async () => {
  const { sent, authorized, run } = setup();
  await run(`
    await jira.comments.add({ key: "APP-1", body: "see [docs](https://x.test)" });
    await jira.comments.update({ key: "APP-1", id: "77", body: "edited" });
    await jira.comments.delete({ key: "APP-1", id: "77" });
    await jira.worklogs.add({ key: "APP-1", time: "1h 30m", started: "2026-03-02T09:00:00Z" });
    await jira.issues.link({ key: "APP-1", to: "APP-2", type: "is blocked by" });
    await jira.issues.link({ key: "APP-1", to: "APP-3", type: "Blocks" });
    await jira.issues.move({ keys: ["APP-1"], sprint: 42 });
    await jira.issues.move({ keys: ["APP-1"], sprint: "backlog" });
  `);
  const comment = lastOf(sent, "POST", "/issue/APP-1/comment")!;
  assert.equal(
    comment.body.body.content[0].content[1].marks[0].attrs.href,
    "https://x.test",
  );
  assert.equal(
    lastOf(sent, "PUT", "/issue/APP-1/comment/77")!.body.body.type,
    "doc",
  );
  assert.ok(lastOf(sent, "DELETE", "/issue/APP-1/comment/77"));
  assert.deepEqual(lastOf(sent, "POST", "/issue/APP-1/worklog")!.body, {
    timeSpent: "1h 30m",
    started: "2026-03-02T09:00:00.000+0000",
  });
  const links = sent.filter((s) => s.path === "/issueLink");
  assert.deepEqual(links[0].body.inwardIssue, { key: "APP-1" });
  assert.deepEqual(links[0].body.outwardIssue, { key: "APP-2" });
  assert.deepEqual(links[1].body.outwardIssue, { key: "APP-1" });
  const moves = sent.filter((s) =>
    /\/rest\/agile\/1\.0\/(sprint\/42|backlog)\/issue$/.test(s.path),
  );
  assert.equal(moves.length, 2);
  assert.deepEqual(moves[0].body, { issues: ["APP-1"] });
  assert.deepEqual(
    authorized.map((a) => [a.toolName, a.args.action]),
    [
      ["jira_manage_comment", "create"],
      ["jira_manage_comment", "update"],
      ["jira_manage_comment", "delete"],
      ["jira_manage_worklog", "create"],
      ["jira_manage_issue_link", "create"],
      ["jira_manage_issue_link", "create"],
      ["jira_manage_backlog", "move_to_sprint"],
      ["jira_manage_backlog", "move_to_backlog"],
    ],
  );
});

void test("issues.link rejects unknown link types with the valid ones", async () => {
  const { run } = setup();
  const result = await run(`
    try { await jira.issues.link({ key: "A-1", to: "A-2", type: "duplicates" }); } catch (e) { console.log(e.message); }
  `);
  assert.match(
    result.content ?? "",
    /Unknown link type "duplicates"\. Valid types: Blocks \("blocks" \/ "is blocked by"\)\./,
  );
});

void test("attachments.upload sends a multipart file read from a workspace handle", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "jira-upload-"));
  await writeFile(join(cwd, "n.txt"), "hi");
  const { sent, authorized, run } = setup();
  const result = await run(
    `return await jira.attachments.upload({ key: "APP-1", file: "n.txt" });`,
    cwd,
  );
  assert.match(result.content ?? "", /"filename": "n.txt"|n\.txt/);
  const upload = lastOf(sent, "POST", "/issue/APP-1/attachments")!;
  assert.ok(upload.body instanceof FormData);
  assert.equal((upload.body.get("file") as File).name, "n.txt");
  assert.deepEqual(
    authorized.map((a) => a.toolName),
    ["jira_manage_attachment", "read"],
  );
});

void test("projects.get include returns create fields, statuses, releases, boards, sprints and epics", async () => {
  const { sent, authorized, run } = setup((req) => {
    if (req.path === "/project/APP")
      return Response.json({
        key: "APP",
        name: "App",
        issueTypes: [{ name: "Bug" }],
      });
    if (req.path === "/project/APP/statuses")
      return Response.json([
        {
          name: "Bug",
          statuses: [{ name: "Open", statusCategory: { name: "To Do" } }],
        },
      ]);
    if (req.path === "/project/APP/versions")
      return Response.json([
        { name: "1.0", released: true, releaseDate: "2026-01-01" },
        { name: "2.0", released: false, releaseDate: "2026-06-01" },
        { name: "0.1", released: true, archived: true },
      ]);
    if (req.path === "/rest/agile/1.0/board")
      return Response.json({
        values: [
          { id: 3, name: "APP board", type: "scrum" },
          { id: 4, name: "Flow", type: "kanban" },
        ],
      });
    if (req.path === "/rest/agile/1.0/board/3/sprint")
      return Response.json({
        values: [
          {
            id: 42,
            name: "Sprint 7",
            state: "active",
            startDate: "2026-03-01",
          },
        ],
      });
    if (req.path === "/search/jql")
      return Response.json({
        issues: [
          {
            key: "APP-5",
            fields: { summary: "Epic", status: { name: "In Progress" } },
          },
        ],
      });
    return undefined;
  });
  const result = await run(`
    return await jira.projects.get({ key: "APP", include: ["fields", "statuses", "releases", "boards", "sprints", "epics"], issueType: "Bug" });
  `);
  const out = returned(result.content);
  assert.deepEqual(out.createFields, [
    {
      issueType: "Bug",
      subtask: false,
      fields: [
        {
          name: "Priority",
          required: false,
          type: "priority",
          allowed: ["High", "Low"],
        },
        {
          name: "Severity",
          required: true,
          type: "option",
          allowed: ["S1", "S2"],
        },
        { name: "Story Points", required: false, type: "number" },
        { name: "Description", required: false, type: "string" },
        { name: "Assignee", required: false, type: "user" },
        { name: "Labels", required: false, type: "array<string>" },
      ],
    },
  ]);
  assert.deepEqual(out.statuses, [
    { issueType: "Bug", statuses: ["Open (To Do)"] },
  ]);
  assert.deepEqual(
    out.releases.map((r: { name: string }) => r.name),
    ["2.0", "1.0"],
  );
  assert.deepEqual(
    out.boards.map((b: { id: number }) => b.id),
    [3, 4],
  );
  assert.deepEqual(out.sprints, [
    {
      id: 42,
      name: "Sprint 7",
      state: "active",
      startDate: "2026-03-01",
      endDate: null,
      goal: null,
      boardId: 3,
    },
  ]);
  assert.deepEqual(out.epics, [
    { key: "APP-5", summary: "Epic", status: "In Progress" },
  ]);
  assert.deepEqual(authorized[0], {
    toolName: "jira_get_project",
    args: {
      project_key: "APP",
      include: ["create_meta", "statuses", "versions"],
    },
  });
  assert.ok(sent.length > 0);
});

void test("issues.get transitions lists reachable statuses and their required fields", async () => {
  const { run } = setup((req) =>
    req.path === "/issue/APP-1"
      ? Response.json({ key: "APP-1", id: "1", fields: { summary: "S" } })
      : undefined,
  );
  const result = await run(
    `return (await jira.issues.get({ key: "APP-1", transitions: true })).transitions;`,
  );
  assert.deepEqual(returned(result.content), [
    { name: "Start", to: "In Progress", requiredFields: [] },
    { name: "Finish", to: "Done", requiredFields: ["Resolution"] },
  ]);
});
