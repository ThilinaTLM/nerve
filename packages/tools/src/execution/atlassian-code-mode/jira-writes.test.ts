import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { lastOf, returned, setup } from "./jira-test-harness.js";

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
    if (req.path === "/rest/agile/1.0/board/4/sprint")
      return Response.json(
        { errorMessages: ["The board does not support sprints"] },
        { status: 400 },
      );
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

void test("projects.get sprints covers simple boards, dedupes shared sprints and can add closed ones", async () => {
  const { sent, run } = setup((req) => {
    if (req.path === "/project/APP") return Response.json({ key: "APP" });
    if (req.path === "/rest/agile/1.0/board")
      return Response.json({
        values: [
          { id: 1, name: "Simple", type: "simple" },
          { id: 2, name: "Also", type: "scrum" },
          { id: 3, name: "Flow", type: "kanban" },
        ],
      });
    if (
      (req.path === "/rest/agile/1.0/board/1/sprint" ||
        req.path === "/rest/agile/1.0/board/2/sprint") &&
      req.query.get("state") === "active,future"
    )
      return Response.json({
        isLast: true,
        values: [{ id: 9, name: "Sprint 0", state: "active" }],
      });
    if (req.path === "/rest/agile/1.0/board/1/sprint") {
      // Closed sprints, oldest first over two pages: only the latest 10 are kept.
      const startAt = Number(req.query.get("startAt"));
      const ids = startAt === 0 ? [1, 2, 3, 4, 5, 6] : [7, 8, 10, 11, 12, 13];
      return Response.json({
        isLast: startAt !== 0,
        values: ids.map((id) => ({ id, name: `S${id}`, state: "closed" })),
      });
    }
    if (req.path === "/rest/agile/1.0/board/2/sprint")
      return Response.json({ isLast: true, values: [] });
    if (req.path === "/rest/agile/1.0/board/3/sprint")
      return Response.json(
        { errorMessages: ["The board does not support sprints"] },
        { status: 400 },
      );
    return undefined;
  });
  const result = await run(`
    return await jira.projects.get({ key: "APP", include: ["closedSprints"] });
  `);
  const out = returned(result.content);
  assert.deepEqual(
    out.sprints.map((s: { id: number; boardId: number }) => [s.id, s.boardId]),
    [...[3, 4, 5, 6, 7, 8, 10, 11, 12, 13].map((id) => [id, 1]), [9, 1]],
  );
  assert.equal(
    sent.filter(
      (r) =>
        r.path.endsWith("/board/1/sprint") && r.query.get("state") === "closed",
    ).length,
    2,
  );
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

void test("an editmeta outage is not swallowed, but a missing edit screen is tolerated", async () => {
  const outage = setup((req) =>
    req.path.endsWith("/editmeta")
      ? new Response("{}", { status: 503 })
      : undefined,
  );
  const failed = await outage.run(
    `try { await jira.issues.update({ key: "APP-1", fields: { Priority: "low" } }); } catch (e) { console.log("failed", e.code); }`,
  );
  assert.match(failed.content ?? "", /failed SERVER_ERROR/);
  assert.equal(lastOf(outage.sent, "PUT", "/issue/APP-1"), undefined);

  const missing = setup((req) =>
    req.path.endsWith("/editmeta")
      ? new Response("{}", { status: 404 })
      : undefined,
  );
  await missing.run(
    `await jira.issues.update({ key: "APP-1", fields: { summary: "S" } });`,
  );
  assert.ok(lastOf(missing.sent, "PUT", "/issue/APP-1"));
});
