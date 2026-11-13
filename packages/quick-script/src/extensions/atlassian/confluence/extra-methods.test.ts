import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  executeQuickScript,
  reconcileReport,
} from "../../../runtime/quick-script.js";
import type { QuickScriptContext } from "../../../runtime/sdk-types.js";
import { normalizeLabels } from "./extra-methods.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

type Seen = {
  method: string;
  path: string;
  search: URLSearchParams;
  body: unknown;
};

function setup(handler: (seen: Seen) => Response | undefined): {
  seen: Seen[];
  context: QuickScriptContext;
} {
  const seen: Seen[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const entry = {
      method: init?.method ?? "GET",
      path: url.pathname
        .replace("/wiki/api/v2", "")
        .replace("/wiki/rest/api", "v1"),
      search: url.searchParams,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    seen.push(entry);
    return handler(entry) ?? new Response("{}", { status: 404 });
  };
  return {
    seen,
    context: {
      cwd: process.cwd(),
      getApiKey: async () => "token",
      getProviderConfig: async () => ({
        enabled: true,
        siteUrl: "https://example.atlassian.net",
        email: "dev@example.com",
      }),
      authorizeNested: async () => {},
    },
  };
}

void test("labels are folded to lowercase with hyphens; other punctuation names the fix", () => {
  assert.deepEqual(normalizeLabels(["Q4 Plan", "q4-plan", "ok_1"]), [
    "q4-plan",
    "ok_1",
  ]);
  assert.throws(
    () => normalizeLabels("Bad Label!"),
    /Invalid label "bad-label!" \(remove "!"\)/,
  );
});

void test("labels reject '.' and name the allowed set", () => {
  assert.throws(
    () => normalizeLabels("v1.0"),
    /Invalid label "v1\.0" \(remove "\."\).*no "\."/,
  );
});

void test("labels.remove checks every label first and lists the current ones", async () => {
  const { context, seen } = setup(({ method, path }) =>
    method === "GET" && path === "v1/content/1/label"
      ? Response.json({ results: [{ name: "a" }, { name: "b" }] })
      : undefined,
  );
  const result = await executeQuickScript(
    {
      code: `try { await confluence.labels.remove({ id: "1", labels: ["a", "zz"] }); } catch (e) { console.log(e.code, e.message); }`,
    },
    context,
  );
  assert.match(
    result.content ?? "",
    /NOT_FOUND Page 1 has no label "zz"; nothing was removed\. Current labels: a, b\./,
  );
  assert.ok(!seen.some((s) => s.method === "DELETE"));
});

void test("comments.list merges footer and inline comments with replies and selection", async () => {
  const { context } = setup(({ path }) =>
    path === "v1/content/1/child/comment"
      ? Response.json({
          results: [
            {
              id: "10",
              type: "comment",
              history: {
                createdDate: "2026-01-01",
                createdBy: { displayName: "Ann" },
              },
              body: { storage: { value: "<p>Hi</p>" } },
              extensions: {
                location: "inline",
                inlineProperties: { originalSelection: "foo" },
                resolution: { status: "open" },
              },
            },
            {
              id: "11",
              history: { createdBy: { displayName: "Bob" } },
              body: { storage: { value: "<p>Re</p>" } },
              ancestors: [{ id: "10", type: "comment" }],
              extensions: { location: "footer" },
            },
          ],
        })
      : undefined,
  );
  const result = await executeQuickScript(
    {
      code: `console.log(JSON.stringify(await confluence.comments.list("1")));
console.log(JSON.stringify((await confluence.comments.list({ id: "1", resolved: true })).length));`,
    },
    context,
  );
  const [first, second] = (result.content ?? "").split("\n");
  assert.deepEqual(JSON.parse(first), [
    {
      id: "10",
      author: "Ann",
      created: "2026-01-01",
      body: "Hi",
      parentId: null,
      inline: { selection: "foo", resolved: false },
    },
    { id: "11", author: "Bob", created: null, body: "Re", parentId: "10" },
  ]);
  assert.equal(second, "0");
});

void test("comments.reply posts to the endpoint of the parent's kind", async () => {
  const { seen, context } = setup(({ method, path }) => {
    if (path === "/footer-comments/10")
      return new Response("{}", { status: 404 });
    if (path === "/inline-comments/10")
      return Response.json({ id: "10", version: { number: 1 } });
    if (method === "POST" && path === "/inline-comments")
      return Response.json({ id: "12" });
    return undefined;
  });
  const result = await executeQuickScript(
    {
      code: `console.log(JSON.stringify(await confluence.comments.reply({ id: "10", body: "Thanks" })));`,
    },
    context,
  );
  assert.match(result.content ?? "", /\{"id":"12","parentId":"10"\}/);
  assert.deepEqual(seen.at(-1)!.body, {
    parentCommentId: "10",
    body: { representation: "storage", value: "<p>Thanks</p>" },
  });
});

void test("pages.delete with purge trashes first and then purges; trashed pages skip the first step", async () => {
  let status = "current";
  const { seen, context } = setup(({ method, path }) => {
    if (method === "GET" && path === "/pages/5")
      return Response.json({ id: "5", title: "T", status });
    if (method === "DELETE") return new Response(null, { status: 204 });
    return undefined;
  });
  await executeQuickScript(
    { code: `await confluence.pages.delete({ id: "5", purge: true });` },
    context,
  );
  const deletes = seen.filter((s) => s.method === "DELETE");
  assert.deepEqual(
    deletes.map((d) => d.search.get("purge")),
    [null, "true"],
  );
  status = "trashed";
  seen.length = 0;
  await executeQuickScript(
    { code: `await confluence.pages.delete({ id: "5", purge: true });` },
    context,
  );
  assert.deepEqual(
    seen.filter((s) => s.method === "DELETE").map((d) => d.search.get("purge")),
    ["true"],
  );
});

void test("a duplicate page title error names the title instead of showing JSON", async () => {
  const { context } = setup(({ method, path }) => {
    if (path === "/spaces")
      return Response.json({
        results: [{ id: "10", key: "DOC", name: "Docs" }],
      });
    if (method === "POST" && path === "/pages")
      return Response.json(
        {
          errors: [
            {
              status: 400,
              title: "Bad Request",
              detail: "A page with this title already exists",
            },
          ],
        },
        { status: 400 },
      );
    return undefined;
  });
  const result = await executeQuickScript(
    {
      code: `try { await confluence.pages.create({ space: "DOC", title: "Dup", body: "x" }); } catch (e) { console.log(e.message); }`,
    },
    context,
  );
  assert.match(
    result.content ?? "",
    /A page titled "Dup" already exists in this space/,
  );
  assert.doesNotMatch(result.content ?? "", /"errors"/);
});

void test("pages.move needs exactly one target and uses the v1 move endpoint", async () => {
  const { seen, context } = setup(({ method }) =>
    method === "PUT" ? Response.json({ id: "5" }) : undefined,
  );
  const result = await executeQuickScript(
    {
      code: `try { await confluence.pages.move({ id: "5" }); } catch (e) { console.log(e.message); }
await confluence.pages.move({ id: "5", parent: "9" });`,
    },
    context,
  );
  assert.match(result.content ?? "", /Give exactly one of parent/);
  assert.equal(seen[0].path, "v1/content/5/move/append/9");
});

void test("comments.add inline counts matches in the page text and sends the selection", async () => {
  const { seen, context } = setup(({ method, path }) => {
    if (method === "GET" && path === "/pages/1")
      return Response.json({
        body: {
          storage: { value: "<p>foo bar</p><p>a <b>foo</b> &amp; foo</p>" },
        },
      });
    if (method === "POST" && path === "/inline-comments")
      return Response.json({ id: "30" });
    return undefined;
  });
  const run = async (inline: string) =>
    (
      await executeQuickScript(
        {
          code: `console.log(JSON.stringify(await confluence.comments.add({ id: "1", body: "Hi", inline: ${inline} })));`,
        },
        context,
      )
    ).content ?? "";
  assert.match(
    await run('{ text: "nope" }'),
    /not found.*shorter exact phrase/,
  );
  assert.match(await run('{ text: "foo" }'), /appears 3 times.*occurrence/);
  assert.match(await run('{ text: "foo", occurrence: 2 }'), /"id":"30"/);
  assert.deepEqual(
    (seen.at(-1)!.body as { inlineCommentProperties: unknown })
      .inlineCommentProperties,
    {
      textSelection: "foo",
      textSelectionMatchCount: 3,
      textSelectionMatchIndex: 1,
    },
  );
});

void test("attachments.delete authorizes with the attachment's real page", async () => {
  const authorized: Record<string, unknown>[] = [];
  const { context } = setup(({ method, path }) => {
    if (method === "GET" && path === "/attachments/9")
      return Response.json({ id: "9", pageId: "77" });
    if (method === "DELETE") return new Response(null, { status: 204 });
    return undefined;
  });
  context.authorizeNested = async (request) => {
    authorized.push(request.args);
  };
  await executeQuickScript(
    { code: `await confluence.attachments.delete("9");` },
    context,
  );
  assert.deepEqual(authorized, [
    { action: "delete", page_id: "77", attachment_id: "9" },
  ]);
});

void test("a page created and deleted in one run is marked in the Deleted list", () => {
  const report = reconcileReport(
    { created: [], updated: [], deleted: ['page 5 "T" (trashed)'], raw: [] },
    ["5"],
  );
  assert.deepEqual(report.deleted, [
    'page 5 "T" (trashed) (created in this run)',
  ]);
});

void test("decision lists read with their state", async () => {
  const { storageXmlToMarkdown } = await import("@nervekit/tools/integrations");
  const item = (state: string, text: string) =>
    `<ac:adf-node type="decision-item"><ac:adf-attribute key="state">${state}</ac:adf-attribute><ac:adf-content>${text}</ac:adf-content></ac:adf-node>`;
  const markdown = await storageXmlToMarkdown(
    `<ac:adf-extension><ac:adf-node type="decision-list">${item("DECIDED", "Ship")}${item("UNDECIDED", "Wait")}</ac:adf-node></ac:adf-extension>`,
  );
  assert.match(markdown, /- \[decided\] Ship\n- \[undecided\] Wait/);
});
