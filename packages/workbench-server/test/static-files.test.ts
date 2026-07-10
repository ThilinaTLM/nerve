import { strict as assert } from "node:assert";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { OrchestratorState } from "../src/app/orchestrator-state.js";
import { serveStatic } from "../src/http/static-files.js";

let previousWebDist: string | undefined;
let tempDir: string | undefined;

const state = {
  host: "127.0.0.1",
  port: 3747,
  storage: { localToken: "test-local-token" },
} as OrchestratorState;

beforeEach(async () => {
  previousWebDist = process.env.NERVE_WEB_DIST;
  tempDir = await mkdtemp(join(tmpdir(), "nerve-static-files-"));
  await mkdir(join(tempDir, "assets"));
  await writeFile(
    join(tempDir, "index.html"),
    "<!doctype html><title>nerve</title>",
  );
  await writeFile(join(tempDir, "assets", "app-abc123.js"), "export {};\n");
  await writeFile(
    join(tempDir, "sw.js"),
    "self.addEventListener('install', () => {});\n",
  );
  process.env.NERVE_WEB_DIST = tempDir;
});

afterEach(async () => {
  if (previousWebDist === undefined) delete process.env.NERVE_WEB_DIST;
  else process.env.NERVE_WEB_DIST = previousWebDist;
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

describe("serveStatic cache headers", () => {
  it("keeps the HTML app shell revalidatable", async () => {
    const response = await serveStatic("/", state, "127.0.0.1");

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-cache");
    assert.match(response.headers.get("set-cookie") ?? "", /nerve_token=/);
  });

  it("serves hashed Vite assets as immutable", async () => {
    const response = await serveStatic(
      "/assets/app-abc123.js",
      state,
      "127.0.0.1",
    );

    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get("cache-control"),
      "public, max-age=31536000, immutable",
    );
  });

  it("keeps service worker files revalidatable", async () => {
    const response = await serveStatic("/sw.js", state, "127.0.0.1");

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-cache");
  });

  it("keeps SPA fallback HTML revalidatable", async () => {
    const response = await serveStatic(
      "/conversations/example",
      state,
      "127.0.0.1",
    );

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-cache");
  });
});
