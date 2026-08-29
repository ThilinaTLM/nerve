import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  jiraDownload,
  jiraMultipartRequest,
  jiraRequest,
  type JiraConnection,
} from "../../src/execution/jira/client.js";

const connection: JiraConnection = {
  siteUrl: "https://example.atlassian.net",
  email: "developer@example.com",
  token: "secret-token",
};

describe("Jira client API roots and downloads", () => {
  it("uses the Jira Software Agile root only when requested", async () => {
    const originalFetch = globalThis.fetch;
    const urls: string[] = [];
    globalThis.fetch = async (input) => {
      urls.push(String(input));
      return Response.json({ values: [] });
    };
    try {
      await jiraRequest(connection, { path: "/issue/ABC-1" });
      await jiraRequest(connection, { api: "agile", path: "/board" });
      assert.equal(
        urls[0],
        "https://example.atlassian.net/rest/api/3/issue/ABC-1",
      );
      assert.equal(
        urls[1],
        "https://example.atlassian.net/rest/agile/1.0/board",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("surfaces bounded structured Jira API diagnostics without query data", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          errorMessages: ["JQL is invalid"],
          authorization: "Bearer super-secret-token",
        }),
        { status: 400, statusText: "Bad Request" },
      );
    try {
      await assert.rejects(
        jiraRequest(connection, {
          method: "POST",
          path: "/search/jql",
          query: { token: "must-not-appear" },
          body: { jql: "broken" },
        }),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          const structured = error as Error & {
            code?: string;
            details?: Record<string, unknown>;
          };
          assert.equal(structured.code, "JIRA_BAD_REQUEST");
          assert.match(
            structured.message,
            /^JIRA_BAD_REQUEST: Jira POST \/search\/jql failed \(400 Bad Request\): JQL is invalid/,
          );
          assert.equal(structured.details?.method, "POST");
          assert.equal(structured.details?.path, "/search/jql");
          assert.equal(structured.details?.reason, "JQL is invalid");
          assert.doesNotMatch(JSON.stringify(structured), /must-not-appear/);
          assert.doesNotMatch(JSON.stringify(structured), /super-secret-token/);
          return true;
        },
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("uploads multipart data with Atlassian CSRF bypass and no manual content type", async () => {
    const originalFetch = globalThis.fetch;
    let headers = new Headers();
    let body: BodyInit | null | undefined;
    globalThis.fetch = async (_input, init) => {
      headers = new Headers(init?.headers);
      body = init?.body;
      return Response.json([{ id: "42" }]);
    };
    try {
      const form = new FormData();
      form.append("file", new Blob(["hello"]), "note.txt");
      await jiraMultipartRequest(connection, {
        path: "/issue/PROJ-1/attachments",
        form,
      });
      assert.equal(headers.get("x-atlassian-token"), "nocheck");
      assert.equal(headers.get("content-type"), null);
      assert.ok(body instanceof FormData);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("downloads bytes without following an authenticated redirect", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(new Uint8Array([1, 2, 3]), {
        headers: {
          "content-type": "text/plain",
          "content-disposition": 'attachment; filename="note.txt"',
        },
      });
    try {
      const result = await jiraDownload(connection, "42");
      assert.deepEqual([...result.bytes], [1, 2, 3]);
      assert.equal(result.filename, "note.txt");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("rejects attachment redirects instead of forwarding credentials", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://attacker.example/file" },
      });
    try {
      await assert.rejects(
        jiraDownload(connection, "42"),
        /authenticated redirect/,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
