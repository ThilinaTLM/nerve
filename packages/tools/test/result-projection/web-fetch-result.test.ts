import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { executeWebFetch } from "../../src/execution/web/web-fetch.js";

let root = "";
let baseUrl = "";
let closeServer: (() => Promise<void>) | undefined;

before(async () => {
  root = await mkdtemp(join(tmpdir(), "nerve-web-result-"));
  const server = createServer((request, response) => {
    response.setHeader("content-type", "text/plain; charset=utf-8");
    response.end(request.url === "/large" ? "x".repeat(20_000) : "small body");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  baseUrl = `http://127.0.0.1:${address.port}`;
  closeServer = () =>
    new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
});

after(async () => {
  await closeServer?.();
  await rm(root, { recursive: true, force: true });
});

describe("web fetch semantic result", () => {
  it("keeps a fitting response inline", async () => {
    const result = await executeWebFetch(
      { url: `${baseUrl}/small` },
      {
        cwd: root,
        artifactDir: root,
        webFetchPolicy: { allowPrivateNetwork: true },
      },
    );
    assert.equal(result.content, "small body");
    const details = result.details as Record<string, unknown>;
    assert.equal(details.savedTo, undefined);
  });

  it("externalizes prose that exceeds the exact agent candidate budget", async () => {
    const result = await executeWebFetch(
      { url: `${baseUrl}/large` },
      {
        cwd: root,
        artifactDir: root,
        webFetchPolicy: { allowPrivateNetwork: true },
      },
    );
    assert.match(result.content ?? "", /Response saved to:/);
    assert.doesNotMatch(result.content ?? "", /x{100}/);
    const details = result.details as Record<string, unknown>;
    const path = details.savedTo;
    assert.equal(typeof path, "string");
    assert.equal((await readFile(path as string, "utf8")).length, 20_000);
    const limits = details.outputLimits as { artifacts?: unknown[] };
    assert.equal(
      (limits.artifacts?.[0] as { role?: string } | undefined)?.role,
      "primary_result",
    );
  });
});
