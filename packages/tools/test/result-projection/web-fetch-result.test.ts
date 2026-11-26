import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import {
  agentResultPolicyForTool,
  projectAgentResult,
} from "../../src/result-projection/index.js";
import { executeWebFetch } from "../../src/execution/web/web-fetch.js";
import { removeTree } from "@nervekit/test-kit";

let root = "";
let baseUrl = "";
let closeServer: (() => Promise<void>) | undefined;

before(async () => {
  root = await mkdtemp(join(tmpdir(), "nerve-web-result-"));
  const server = createServer((request, response) => {
    response.setHeader("content-type", "text/plain; charset=utf-8");
    if (request.url === "/missing") response.statusCode = 404;
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
  await removeTree(root);
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

  it("returns an HTTP error page with its status shown once", async () => {
    const result = await executeWebFetch(
      { url: `${baseUrl}/missing` },
      {
        cwd: root,
        artifactDir: root,
        webFetchPolicy: { allowPrivateNetwork: true },
      },
    );
    assert.equal((result.details as { status?: number }).status, 404);
    // The model reads the projected result: the status appears once, ahead of the body.
    const projected = projectAgentResult(
      {
        toolName: "web_fetch",
        args: {},
        result,
        status: "completed",
        phase: "completed",
        validatedArtifacts: [],
      },
      agentResultPolicyForTool("web_fetch"),
    );
    const text = projected.blocks
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("");
    assert.equal(text.match(/HTTP \d{3}|HTTP status/g)?.length, 1);
    assert.match(
      text,
      /^URL: [^\n]*\nHTTP status: 404\n[\s\S]*\n\nsmall body$/,
    );
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
