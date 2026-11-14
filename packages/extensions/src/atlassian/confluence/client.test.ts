import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  confluenceDownload,
  confluenceRequest,
  type ConfluenceConnection,
} from "./client.js";

const connection: ConfluenceConnection = {
  siteUrl: "https://example.atlassian.net",
  email: "developer@example.com",
  token: "secret-token",
};

describe("Confluence attachment downloads", () => {
  it("surfaces canonical Confluence diagnostics with method and safe path", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response("Page does not exist", {
        status: 404,
        statusText: "Not Found",
      });
    try {
      await assert.rejects(
        confluenceRequest(connection, {
          path: "/pages/999",
          query: { cursor: "private-cursor" },
        }),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          const structured = error as Error & {
            code?: string;
            details?: Record<string, unknown>;
          };
          assert.equal(structured.code, "CONFLUENCE_NOT_FOUND");
          assert.equal(structured.details?.method, "GET");
          assert.equal(structured.details?.path, "/pages/999");
          assert.equal(structured.details?.reason, "Page does not exist");
          assert.match(structured.message, /Page does not exist/);
          assert.doesNotMatch(structured.message, /See .*SKILL\.md/);
          assert.doesNotMatch(JSON.stringify(structured), /private-cursor/);
          return true;
        },
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("reports malformed requests with the server reason", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response("Invalid body format", { status: 400 });
    try {
      await assert.rejects(
        confluenceRequest(connection, {
          method: "POST",
          path: "/pages",
          body: {},
        }),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.match(error.message, /Invalid body format/);
          return true;
        },
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("rejects cross-origin URLs before sending credentials", async () => {
    await assert.rejects(
      confluenceDownload(connection, "https://attacker.example/file"),
      /outside the configured site/,
    );
  });

  it("allows same-origin absolute attachment URLs", async () => {
    const originalFetch = globalThis.fetch;
    let requested: URL | string | Request | undefined;
    let authorization: string | null = null;
    globalThis.fetch = async (input, init) => {
      requested = input;
      authorization = new Headers(init?.headers).get("authorization");
      return new Response(new Uint8Array([1, 2, 3]));
    };
    try {
      const content = await confluenceDownload(
        connection,
        "https://example.atlassian.net/wiki/download/attachments/1/file.txt",
      );
      assert.deepEqual([...content], [1, 2, 3]);
      assert.equal(new URL(String(requested)).origin, connection.siteUrl);
      assert.match(authorization ?? "", /^Basic /);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("Confluence client response validation", () => {
  it("rejects a non-JSON body with status, content type and snippet", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response("<html>Proxy error</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    try {
      await assert.rejects(
        confluenceRequest(connection, { path: "/thing" }),
        (error: unknown) => {
          const details = (error as { details?: Record<string, unknown> })
            .details;
          assert.equal(details?.status, 200);
          assert.equal(details?.contentType, "text/html");
          assert.match(String(details?.snippet), /Proxy error/);
          return true;
        },
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
