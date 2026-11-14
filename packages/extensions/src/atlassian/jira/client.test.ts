import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ExtensionError } from "@nervekit/extension-api";
import { anyJson } from "../shared/http.js";
import { createHarness, SITE, type FetchLike } from "../test-support.js";
import {
  jiraDownloadToArtifact,
  jiraMultipartRequest,
  jiraRequest,
  type JiraConnection,
} from "./client.js";

function connect(fetch: FetchLike) {
  const harness = createHarness({ fetch });
  const connection: JiraConnection = { ctx: harness.ctx, siteUrl: SITE };
  return { ...harness, connection };
}

describe("Jira client API roots and downloads", () => {
  it("uses the Jira Software Agile root only when requested", async () => {
    const urls: string[] = [];
    const { connection } = connect(async (url) => {
      urls.push(url.toString());
      return Response.json({ values: [] });
    });
    await jiraRequest(connection, { path: "/issue/ABC-1" });
    await jiraRequest(connection, { api: "agile", path: "/board" });
    assert.equal(urls[0], `${SITE}/rest/api/3/issue/ABC-1`);
    assert.equal(urls[1], `${SITE}/rest/agile/1.0/board`);
  });

  it("sends every request with the account, never with credentials of its own", async () => {
    const { connection, record } = connect(async () => Response.json({}));
    await jiraRequest(connection, { path: "/myself" });
    assert.deepEqual(record.requests[0].auth, { account: "account" });
    assert.equal(
      Object.keys(record.requests[0].headers ?? {}).some((name) =>
        /authorization/i.test(name),
      ),
      false,
    );
  });

  it("surfaces bounded structured Jira API diagnostics without query data", async () => {
    const { connection } = connect(
      async () =>
        new Response(
          JSON.stringify({
            errorMessages: ["JQL is invalid"],
            authorization: "Bearer super-secret-token",
          }),
          { status: 400, statusText: "Bad Request" },
        ),
    );
    await assert.rejects(
      jiraRequest(connection, {
        method: "POST",
        path: "/search/jql",
        query: { token: "must-not-appear" },
        body: { jql: "broken" },
      }),
      (error: unknown) => {
        assert.ok(error instanceof ExtensionError);
        assert.equal(error.code, "BAD_REQUEST");
        assert.match(
          error.message,
          /^Jira POST \/search\/jql failed \(400 Bad Request\): JQL is invalid/,
        );
        assert.doesNotMatch(error.message, /must-not-appear/);
        assert.doesNotMatch(error.message, /super-secret-token/);
        return true;
      },
    );
  });

  it("maps statuses to script-visible codes", async () => {
    for (const [status, code] of [
      [404, "NOT_FOUND"],
      [409, "CONFLICT"],
      [429, "RATE_LIMITED"],
      [503, "SERVER_ERROR"],
    ] as const) {
      const { connection } = connect(
        async () => new Response("no", { status }),
      );
      await assert.rejects(
        jiraRequest(connection, { path: "/x" }),
        (error: unknown) =>
          error instanceof ExtensionError && error.code === code,
      );
    }
  });

  it("a refused credential ends the call as the host reports it", async () => {
    const { connection } = connect(
      async () => new Response("no", { status: 401 }),
    );
    await assert.rejects(
      jiraRequest(connection, { path: "/myself" }),
      (error: unknown) =>
        error instanceof ExtensionError && error.code === "UNAUTHORIZED",
    );
  });

  it("uploads multipart parts with Atlassian CSRF bypass and no manual content type", async () => {
    let headers = new Headers();
    let body: unknown;
    const { connection, record } = connect(async (_url, init) => {
      headers = init.headers;
      body = init.body;
      return Response.json([{ id: "42" }]);
    });
    await jiraMultipartRequest(connection, {
      path: "/issue/PROJ-1/attachments",
      parts: [
        {
          name: "file",
          filename: "note.txt",
          mediaType: "text/plain",
          data: new TextEncoder().encode("hello"),
        },
      ],
      parse: anyJson,
    });
    assert.equal(record.requests[0].headers?.["X-Atlassian-Token"], "nocheck");
    assert.equal(headers.get("content-type"), null);
    assert.ok(body instanceof FormData);
  });

  it("streams an attachment into an artifact without following a redirect to another host", async () => {
    const urls: string[] = [];
    const { connection, record } = connect(async (url) => {
      urls.push(url.toString());
      return new Response(new Uint8Array([1, 2, 3]), {
        headers: {
          "content-type": "text/plain",
          "content-disposition": 'attachment; filename="note.txt"',
        },
      });
    });
    const result = await jiraDownloadToArtifact(connection, "42", {
      name: "note.txt",
    });
    assert.deepEqual(
      [...record.artifacts.get(result.artifact.handle)!.bytes],
      [1, 2, 3],
    );
    assert.equal(result.filename, "note.txt");
    // Jira answers with the content itself; the credential never leaves the site.
    assert.equal(
      urls[0],
      `${SITE}/rest/api/3/attachment/content/42?redirect=false`,
    );
  });
});

describe("Jira client response validation", () => {
  it("rejects a non-JSON body with status, content type and snippet", async () => {
    const { connection } = connect(
      async () =>
        new Response("<html>Proxy error</html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    );
    await assert.rejects(
      jiraRequest(connection, { path: "/thing" }),
      (error: unknown) => {
        assert.ok(error instanceof ExtensionError);
        assert.equal(error.code, "SERVER_ERROR");
        assert.match(error.message, /HTTP 200, text\/html/);
        assert.match(error.message, /Proxy error/);
        return true;
      },
    );
  });
});
