import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ExtensionError } from "@nervekit/extension-api";
import { createHarness, SITE, type FetchLike } from "../test-support.js";
import {
  confluenceDownload,
  confluenceDownloadToArtifact,
  confluenceRequest,
  type ConfluenceConnection,
} from "./client.js";

function connect(fetch: FetchLike) {
  const harness = createHarness({ fetch });
  const connection: ConfluenceConnection = {
    ctx: harness.ctx,
    siteUrl: SITE,
  };
  return { ...harness, connection };
}

describe("Confluence client", () => {
  it("surfaces canonical Confluence diagnostics with method and safe path", async () => {
    const { connection } = connect(
      async () =>
        new Response("Page does not exist", {
          status: 404,
          statusText: "Not Found",
        }),
    );
    await assert.rejects(
      confluenceRequest(connection, {
        path: "/pages/999",
        query: { cursor: "private-cursor" },
      }),
      (error: unknown) => {
        assert.ok(error instanceof ExtensionError);
        assert.equal(error.code, "NOT_FOUND");
        assert.match(
          error.message,
          /^Confluence GET \/pages\/999 failed \(404 Not Found\): Page does not exist/,
        );
        assert.doesNotMatch(error.message, /See .*SKILL\.md/);
        assert.doesNotMatch(error.message, /private-cursor/);
        return true;
      },
    );
  });

  it("reports malformed requests with the server reason", async () => {
    const { connection } = connect(
      async () => new Response("Invalid body format", { status: 400 }),
    );
    await assert.rejects(
      confluenceRequest(connection, {
        method: "POST",
        path: "/pages",
        body: {},
      }),
      /Invalid body format/,
    );
  });

  it("rejects cross-origin URLs before sending credentials", async () => {
    const { connection, record } = connect(async () => new Response(""));
    await assert.rejects(
      confluenceDownload(connection, "https://attacker.example/file"),
      /outside the configured site/,
    );
    assert.equal(record.requests.length, 0);
  });

  it("allows same-origin absolute attachment URLs", async () => {
    let requested: URL | undefined;
    const { connection, record } = connect(async (url) => {
      requested = url;
      return new Response(new Uint8Array([1, 2, 3]));
    });
    const content = await confluenceDownload(
      connection,
      `${SITE}/wiki/download/attachments/1/file.txt`,
    );
    assert.deepEqual([...content], [1, 2, 3]);
    assert.equal(requested?.origin, SITE);
    assert.deepEqual(record.requests[0].auth, { account: "account" });
  });

  it("streams an attachment into an artifact; the host follows the media redirect without the credential", async () => {
    const hops: string[] = [];
    const { connection, record } = connect(async (url, init) => {
      hops.push(
        `${url.origin}${init.headers.has("authorization") ? " signed" : ""}`,
      );
      return url.origin === SITE
        ? new Response(null, {
            status: 302,
            headers: { location: "https://api.media.atlassian.com/file/x" },
          })
        : new Response(new Uint8Array([9, 9]));
    });
    const artifact = await confluenceDownloadToArtifact(
      connection,
      "/download/attachments/1/a.bin",
      { name: "a.bin" },
    );
    assert.deepEqual([...record.artifacts.get(artifact.handle)!.bytes], [9, 9]);
    assert.deepEqual(hops, [SITE, "https://api.media.atlassian.com"]);
    assert.equal(
      record.requests[0].url,
      `${SITE}/wiki/download/attachments/1/a.bin`,
    );
  });
});

describe("Confluence client response validation", () => {
  it("rejects a non-JSON body with status, content type and snippet", async () => {
    const { connection } = connect(
      async () =>
        new Response("<html>Proxy error</html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    );
    await assert.rejects(
      confluenceRequest(connection, { path: "/thing" }),
      (error: unknown) => {
        assert.ok(error instanceof ExtensionError);
        assert.match(error.message, /HTTP 200, text\/html/);
        assert.match(error.message, /Proxy error/);
        return true;
      },
    );
  });
});
