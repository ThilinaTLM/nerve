import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  confluenceDownload,
  type ConfluenceConnection,
} from "../src/execution/confluence/client.js";

const connection: ConfluenceConnection = {
  siteUrl: "https://example.atlassian.net",
  email: "developer@example.com",
  token: "secret-token",
};

describe("Confluence attachment downloads", () => {
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
