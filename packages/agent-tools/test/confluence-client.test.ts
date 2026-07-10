import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  type ConfluenceConnection,
  confluenceDownload,
} from "../src/execution/confluence/client.js";

const connection: ConfluenceConnection = {
  siteUrl: "https://example.atlassian.net",
  email: "user@example.com",
  token: "api-token",
};

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("Confluence client downloads", () => {
  it("resolves Confluence attachment download links under the /wiki context", async () => {
    const cases = [
      {
        downloadLink: "/rest/api/content/1/child/attachment/att2/download",
        expected:
          "https://example.atlassian.net/wiki/rest/api/content/1/child/attachment/att2/download",
      },
      {
        downloadLink: "/download/attachments/1/file.txt?version=2",
        expected:
          "https://example.atlassian.net/wiki/download/attachments/1/file.txt?version=2",
      },
      {
        downloadLink: "/wiki/download/attachments/1/file.txt",
        expected:
          "https://example.atlassian.net/wiki/download/attachments/1/file.txt",
      },
      {
        downloadLink: "https://cdn.example.test/download/file.txt",
        expected: "https://cdn.example.test/download/file.txt",
      },
    ];

    for (const { downloadLink, expected } of cases) {
      const calls = mockFetchBytes([1, 2, 3]);

      const bytes = await confluenceDownload(connection, downloadLink);

      assert.deepEqual([...bytes], [1, 2, 3]);
      assert.equal(calls.length, 1);
      assert.equal(String(calls[0]?.input), expected);
      const headers = calls[0]?.init?.headers as Record<string, string>;
      assert.match(headers.Authorization, /^Basic /);
    }
  });
});

function mockFetchBytes(bytes: number[]) {
  const calls: Array<{
    input: Parameters<typeof fetch>[0];
    init: Parameters<typeof fetch>[1];
  }> = [];
  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
    calls.push({ input: args[0], init: args[1] });
    return new Response(new Uint8Array(bytes), { status: 200 });
  }) as typeof fetch;
  return calls;
}
