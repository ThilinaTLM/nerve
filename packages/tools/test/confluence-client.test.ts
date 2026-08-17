import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  confluenceDownload,
  confluenceRequest,
  type ConfluenceConnection,
} from "../src/execution/confluence/client.js";

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
          assert.doesNotMatch(JSON.stringify(structured), /private-cursor/);
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
