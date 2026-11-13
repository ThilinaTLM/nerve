import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { lastOf, setup } from "./test-harness.js";
import { nestedName } from "../../../runtime/test-nested.js";

/** The returned JSON: before the footer and the "Created:" line. */
const returned = (content: string | undefined) =>
  JSON.parse(
    (content ?? "").split(/\n(?:Created|Updated|Deleted):|\njira /)[0],
  );

const UUID = "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0";
const AGILE = "/rest/agile/1.0";

const ATTACHMENTS = {
  fields: {
    attachment: [
      {
        id: "7",
        filename: "shot.png",
        mimeType: "image/png",
        size: 5,
        created: "2026-01-01T00:00:00.000+0000",
        author: { displayName: "Ann" },
      },
      {
        id: "8",
        filename: "shot.png",
        mimeType: "image/png",
        size: 6,
        created: "2026-02-01T00:00:00.000+0000",
        author: { displayName: "Ann" },
      },
      {
        id: "9",
        filename: "doc.pdf",
        mimeType: "application/pdf",
        size: 1,
        created: "2026-02-02T00:00:00.000+0000",
      },
    ],
  },
};

function mediaMocks(s: { path: string; method: string }) {
  if (s.method === "GET" && s.path === "/issue/APP-1")
    return Response.json(ATTACHMENTS);
  if (s.path.startsWith("/attachment/content/"))
    return new Response(null, {
      status: 303,
      headers: {
        location: `https://api.media.atlassian.com/file/${UUID}/binary?token=x`,
      },
    });
  return undefined;
}

void test("attachments.list returns details, and ![](name) becomes a media node of the newest attachment", async () => {
  const { sent, run } = setup(mediaMocks);
  const result = await run(`
    const list = await jira.attachments.list("APP-1");
    await jira.comments.add({ key: "APP-1", body: "See:\\n\\n![](shot.png)\\n\\nand ![logo](https://x.test/l.png)" });
    return list.map((a) => [a.id, a.filename, a.author]);
  `);
  assert.deepEqual(returned(result.content), [
    ["7", "shot.png", "Ann"],
    ["8", "shot.png", "Ann"],
    ["9", "doc.pdf", null],
  ]);
  assert.ok(sent.some((s) => s.path === "/attachment/content/8"));
  const body = lastOf(sent, "POST", "/issue/APP-1/comment")!.body.body;
  assert.deepEqual(body.content[1], {
    type: "mediaSingle",
    attrs: { layout: "center" },
    content: [
      {
        type: "media",
        attrs: { type: "file", id: UUID, collection: "", alt: "shot.png" },
      },
    ],
  });
  // A URL image is a link, never a stray "!".
  const text = JSON.stringify(body.content[2]);
  assert.match(text, /"href":"https:\/\/x.test\/l.png"/);
  assert.doesNotMatch(text, /!/);
});

void test("embedding names the attached files for unknown or non-image names", async () => {
  const { run } = setup(mediaMocks);
  const result = await run(`
    for (const body of ["![](nope.png)", "![](doc.pdf)"]) {
      try { await jira.comments.add({ key: "APP-1", body }); } catch (e) { console.log(e.message); }
    }
  `);
  const lines = (result.content ?? "").split("\n");
  assert.match(
    lines[0],
    /Image "nope.png" is not an attachment of APP-1\. Attached: shot.png, shot.png, doc.pdf\./,
  );
  assert.match(lines[1], /"doc.pdf" is application\/pdf; only images/);
});

void test("issues.create uploads attachments and sets the description afterwards", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "jira-create-"));
  await writeFile(join(cwd, "shot.png"), "png");
  const { sent, authorized, run } = setup((s) => {
    if (s.method === "GET" && s.path === "/issue/APP-10")
      return Response.json(ATTACHMENTS);
    if (s.path === "/issue/APP-10/attachments")
      return Response.json([{ id: "8", filename: "shot.png", size: 3 }]);
    return mediaMocks(s);
  });
  const result = await run(
    `return await jira.issues.create({ type: "Task", summary: "s", description: "Look: ![](shot.png)", attachments: ["shot.png"] });`,
    cwd,
  );
  assert.equal(returned(result.content).attachments[0].id, "8");
  assert.equal(
    lastOf(sent, "POST", "/issue")!.body.fields.description,
    undefined,
  );
  const update = lastOf(sent, "PUT", "/issue/APP-10")!;
  assert.equal(update.body.fields.description.content[1].type, "mediaSingle");
  assert.deepEqual(authorized.map(nestedName), ["jira.issues.create", "read"]);
});

void test("worklogs: update, delete, tidy bad-time message, and clean errors", async () => {
  const { sent, authorized, run } = setup((s) => {
    if (s.method === "POST" && s.path === "/issue/APP-1/worklog")
      return Response.json(
        {
          errorMessages: ["Worklog must not be null."],
          errors: { timeLogged: "Invalid time duration entered." },
        },
        { status: 400 },
      );
    if (s.method === "PUT" && s.path === "/issue/APP-1/worklog/5")
      return Response.json({ id: "5", timeSpent: "2h" });
    if (s.method === "GET" && s.path === "/issue/APP-9")
      return Response.json(
        { errorMessages: ["Issue does not exist"] },
        { status: 404 },
      );
  });
  const result = await run(`
    console.log(JSON.stringify(await jira.worklogs.update({ key: "APP-1", id: "5", time: "2h" })));
    await jira.worklogs.delete({ key: "APP-1", id: "5" });
    for (const f of [
      () => jira.worklogs.add({ key: "APP-1", time: "soon" }),
      () => jira.issues.get("APP-9"),
    ]) {
      try { await f(); } catch (e) { console.log(e.code, e.message); }
    }
  `);
  const lines = (result.content ?? "").split("\n");
  assert.equal(lines[0], '{"id":"5","timeSpent":"2h"}');
  assert.match(lines[1], /^BAD_REQUEST APP-1: time must look like "1h 30m"/);
  assert.equal(lines[2], "NOT_FOUND APP-9: Issue does not exist");
  assert.deepEqual(lastOf(sent, "PUT", "/issue/APP-1/worklog/5")!.body, {
    timeSpent: "2h",
  });
  assert.ok(lastOf(sent, "DELETE", "/issue/APP-1/worklog/5"));
  assert.deepEqual(authorized.slice(0, 2).map(nestedName), [
    "jira.worklogs.update",
    "jira.worklogs.delete",
  ]);
});

void test("issues.unlink removes links by key, asks for type when ambiguous", async () => {
  const links = [
    {
      id: "1",
      type: { name: "Blocks", inward: "is blocked by", outward: "blocks" },
      outwardIssue: { key: "APP-2" },
    },
    {
      id: "2",
      type: { name: "Relates", inward: "relates to", outward: "relates to" },
      inwardIssue: { key: "APP-2" },
    },
    {
      id: "3",
      type: { name: "Blocks", inward: "is blocked by", outward: "blocks" },
      outwardIssue: { key: "APP-3" },
    },
  ];
  const { sent, run } = setup((s) =>
    s.method === "GET" && s.path === "/issue/APP-1"
      ? Response.json({ fields: { issuelinks: links } })
      : undefined,
  );
  const result = await run(`
    try { await jira.issues.unlink({ key: "APP-1", to: "APP-2" }); } catch (e) { console.log(e.message); }
    try { await jira.issues.unlink({ key: "APP-1", to: "APP-9" }); } catch (e) { console.log(e.message); }
    return await jira.issues.unlink({ key: "APP-1", to: "APP-2", type: "blocks" });
  `);
  const lines = (result.content ?? "").split("\n");
  assert.match(
    lines[0],
    /linked to APP-2 in several ways \(Blocks, Relates\); pass type/,
  );
  assert.match(
    lines[1],
    /APP-1 has no link to APP-9\. Its links: blocks APP-2, relates to APP-2, blocks APP-3/,
  );
  assert.deepEqual(
    sent.filter((s) => s.method === "DELETE").map((s) => s.path),
    ["/issueLink/1"],
  );
});

void test("issues.rank sends one anchor to the agile API", async () => {
  const { sent, authorized, run } = setup();
  const result = await run(`
    try { await jira.issues.rank({ keys: ["APP-3"] }); } catch (e) { console.log(e.message); }
    return await jira.issues.rank({ keys: ["APP-3", "APP-4"], after: "APP-1" });
  `);
  assert.match(result.content ?? "", /exactly one of before or after/);
  assert.deepEqual(lastOf(sent, "PUT", `${AGILE}/issue/rank`)!.body, {
    issues: ["APP-3", "APP-4"],
    rankAfterIssue: "APP-1",
  });
  assert.equal(nestedName(authorized[0]), "jira.issues.rank");
});

void test("sprints: create picks the only scrum board, start needs an end, close moves open issues", async () => {
  const sprint = (state: string, extra = {}) => ({
    id: 5,
    name: "S5",
    state,
    originBoardId: 3,
    ...extra,
  });
  let current = sprint("future");
  const { sent, authorized, run } = setup((s) => {
    if (s.path === `${AGILE}/board`)
      return Response.json({ values: [{ id: 3, name: "APP board" }] });
    if (s.method === "POST" && s.path === `${AGILE}/sprint`)
      return Response.json(sprint("future"));
    if (s.method === "GET" && s.path === `${AGILE}/sprint/5`)
      return Response.json(current);
    if (s.method === "PUT" && s.path === `${AGILE}/sprint/5`) {
      current = { ...current, ...s.body };
      return Response.json(current);
    }
    if (s.method === "GET" && s.path === `${AGILE}/sprint/5/issue`)
      return Response.json({ issues: [{ key: "APP-1" }], total: 1 });
  });
  const result = await run(`
    const made = await jira.sprints.create({ name: "S5" });
    try { await jira.sprints.start({ id: 5 }); } catch (e) { console.log(e.message); }
    const started = await jira.sprints.start({ id: 5, duration: "2w" });
    const closed = await jira.sprints.close({ id: 5, moveOpenTo: "backlog" });
    return [made.boardId, started.state, closed.state, closed.moved];
  `);
  assert.match(result.content ?? "", /Sprint 5 has no end date/);
  assert.deepEqual(
    returned((result.content ?? "").split("\n").slice(1).join("\n")),
    [3, "active", "closed", ["APP-1"]],
  );
  assert.equal(lastOf(sent, "POST", `${AGILE}/sprint`)!.body.originBoardId, 3);
  const issuesCall = sent.find(
    (s) => s.path === `${AGILE}/sprint/5/issue` && s.method === "GET",
  )!;
  assert.equal(issuesCall.query.get("jql"), "statusCategory != Done");
  assert.deepEqual(lastOf(sent, "POST", `${AGILE}/backlog/issue`)!.body, {
    issues: ["APP-1"],
  });
  const started = sent.filter((s) => s.method === "PUT")[0].body;
  assert.equal(started.state, "active");
  assert.ok(Date.parse(started.endDate) > Date.now() + 13 * 86_400_000);
  assert.deepEqual(authorized.map(nestedName), [
    "jira.sprints.create",
    "jira.sprints.start",
    "jira.sprints.start",
    "jira.sprints.close",
  ]);
});

void test("sprints.create accepts a team-managed (simple) board and skips kanban", async () => {
  const { sent, run } = setup((s) => {
    if (s.path === `${AGILE}/board`)
      return Response.json({
        values: [
          { id: 1, name: "SCRUM board", type: "simple" },
          { id: 2, name: "Flow", type: "kanban" },
        ],
      });
    if (s.method === "POST" && s.path === `${AGILE}/sprint`)
      return Response.json({
        id: 9,
        name: "S",
        state: "future",
        originBoardId: 1,
      });
  });
  await run(`await jira.sprints.create({ name: "S", project: "SCRUM" });`);
  assert.equal(lastOf(sent, "POST", `${AGILE}/sprint`)!.body.originBoardId, 1);
});
