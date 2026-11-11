import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { returned, setup } from "./test-harness.js";

const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0, 255, 0xc3, 0x28, 13, 10,
]);

void test("attachments.download writes exact bytes to a fresh artifact and authorizes as a read", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jira-dl-"));
  const { authorized, run } = setup((s) => {
    if (s.path === "/attachment/9")
      return Response.json({ id: "9", filename: "shot one.png", size: 10 });
    if (s.path === "/attachment/content/9")
      return new Response(PNG, { headers: { "content-type": "image/png" } });
  });
  const result = await run(
    `const a = await jira.attachments.download("9");
     const b = await jira.attachments.download({ id: "9", name: "x.png" });
     return [a, b];`,
    process.cwd(),
    dir,
  );
  assert.match(result.content ?? "", /artifact:shot one-1\.png/);
  assert.match(result.content ?? "", /artifact:x\.png/);
  for (const name of ["shot one-1.png", "x.png"]) {
    assert.deepEqual(
      new Uint8Array(await readFile(join(dir, "quick-script", name))),
      PNG,
    );
  }
  assert.deepEqual(authorized[0], {
    toolName: "jira_download_attachment",
    args: { attachment_id: "9" },
  });
});

void test("attachments.download refuses files over the size limit", async () => {
  const { run } = setup((s) => {
    if (s.path === "/attachment/9")
      return Response.json({ id: "9", filename: "big.zip", size: 30_000_000 });
  });
  const result = await run(
    `try { await jira.attachments.download("9"); } catch (e) { console.log(e.code, e.message); }`,
    process.cwd(),
    await mkdtemp(join(tmpdir(), "jira-dl-")),
  );
  assert.match(
    result.content ?? "",
    /BAD_REQUEST Attachment 9 is 28.6 MB.*jira_download_attachment/,
  );
});

void test("issues.delete passes deleteSubtasks, needs approval, and explains the subtask refusal", async () => {
  const { sent, authorized, run } = setup((s) => {
    if (s.method === "DELETE" && s.path === "/issue/APP-2")
      return s.query.get("deleteSubtasks") === "true"
        ? new Response(null, { status: 204 })
        : Response.json(
            { errorMessages: ["The issue has subtasks"] },
            { status: 400 },
          );
  });
  const result = await run(`
    try { await jira.issues.delete("APP-2"); } catch (e) { console.log(e.code, e.message); }
    return await jira.issues.delete({ key: "APP-2", subtasks: true });
  `);
  assert.match(
    result.content ?? "",
    /BAD_REQUEST APP-2 was not deleted.*subtasks: true/,
  );
  assert.equal(
    sent
      .filter((s) => s.method === "DELETE")
      .at(-1)!
      .query.get("deleteSubtasks"),
    "true",
  );
  assert.equal(authorized[0].toolName, "jira_update_issue");
  assert.deepEqual(authorized[0].args, { issue_key: "APP-2" });
  assert.equal((authorized[0] as { summary?: string }).summary, undefined);
});

void test("projects.list pages through /project/search and users.me reads /myself", async () => {
  const { sent, authorized, run } = setup((s) => {
    if (s.path === "/project/search")
      return s.query.get("startAt") === "0"
        ? Response.json({
            values: [{ key: "A", name: "Alpha", projectTypeKey: "software" }],
            isLast: false,
          })
        : Response.json({
            values: [{ key: "B", name: "Beta", projectTypeKey: "business" }],
            isLast: true,
          });
    if (s.path === "/myself")
      return Response.json({
        accountId: "me1",
        displayName: "Me",
        emailAddress: "me@example.com",
        timeZone: "Europe/Oslo",
      });
  });
  const result = await run(
    `return [await jira.projects.list(), await jira.users.me()];`,
  );
  assert.deepEqual(returned(result.content), [
    [
      { key: "A", name: "Alpha", type: "software" },
      { key: "B", name: "Beta", type: "business" },
    ],
    {
      accountId: "me1",
      name: "Me",
      email: "me@example.com",
      timeZone: "Europe/Oslo",
    },
  ]);
  assert.equal(sent.filter((s) => s.path === "/project/search").length, 2);
  assert.deepEqual(
    authorized.map((a) => a.toolName),
    ["jira_get_project", "jira_search_users"],
  );
});

void test("jira.adf converts Markdown both ways without authorization", async () => {
  const { authorized, run } = setup();
  const result = await run(`
    const doc = await jira.adf.fromMarkdown("hello **bold**");
    return [doc.type, await jira.adf.toMarkdown(doc)];
  `);
  assert.deepEqual(returned(result.content), ["doc", "hello **bold**"]);
  assert.equal(authorized.length, 0);
});

void test("jira.request encodes query values and saves binary GET responses as artifacts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jira-raw-"));
  const { sent, run } = setup((s) => {
    if (s.path === "/thumb.png")
      return new Response(PNG, { headers: { "content-type": "image/png" } });
  });
  const result = await run(
    `const j = await jira.request("GET", "/rest/api/3/search/jql", undefined, { jql: "a b&c", fields: ["x", "y"], n: 2 });
     return await jira.request("GET", "/rest/api/3/thumb.png");`,
    process.cwd(),
    dir,
  );
  const call = sent.find((s) => s.path === "/search/jql")!;
  assert.equal(call.query.get("jql"), "a b&c");
  assert.deepEqual(call.query.getAll("fields"), ["x", "y"]);
  assert.equal(call.query.get("n"), "2");
  assert.match(result.content ?? "", /artifact:response-1\.png/);
  assert.deepEqual(
    new Uint8Array(await readFile(join(dir, "quick-script", "response-1.png"))),
    PNG,
  );
});

void test("every Jira create path reports what it created", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "jira-created-"));
  await writeFile(join(cwd, "n.txt"), "hi");
  const { run } = setup();
  const result = await run(
    `await jira.issues.create({ type: "Task", summary: "s" });
     await jira.comments.add({ key: "APP-1", body: "x" });
     await jira.worklogs.add({ key: "APP-1", time: "1h" });
     await jira.issues.link({ key: "APP-1", to: "APP-2", type: "Blocks" });
     await jira.attachments.upload({ key: "APP-1", file: "n.txt" });`,
    cwd,
  );
  assert.deepEqual((result.details as { created?: string[] }).created, [
    "APP-10",
    "comment 77 on APP-1",
    "worklog 5 on APP-1",
    "link APP-1→APP-2",
    "attachment 9 on APP-1",
  ]);
});
