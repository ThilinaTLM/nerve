import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import type { WorkbenchState } from "../src/app/workbench-state.js";
import { serveStatic } from "../src/http/static-files.js";

const roots: string[] = [];
const originalWebDist = process.env.NERVE_WEB_DIST;

before(() => {
  delete process.env.NERVE_WEB_DIST;
});

after(async () => {
  if (originalWebDist === undefined) delete process.env.NERVE_WEB_DIST;
  else process.env.NERVE_WEB_DIST = originalWebDist;
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "nerve-static-files-"));
  roots.push(root);
  const webDist = join(root, "web");
  const sibling = join(root, "web-evil");
  await mkdir(join(webDist, "assets"), { recursive: true });
  await mkdir(sibling);
  await writeFile(join(webDist, "index.html"), "safe index");
  await writeFile(join(webDist, "assets", "app.js"), "safe asset");
  await writeFile(join(sibling, "secret.txt"), "outside secret");
  process.env.NERVE_WEB_DIST = webDist;
  return { webDist, sibling };
}

const state = {
  host: "127.0.0.1",
  storage: { localToken: "test-token" },
} as WorkbenchState;

describe("static file serving", () => {
  it("serves nested assets inside the configured distribution", async () => {
    await fixture();
    const response = await serveStatic("/assets/app.js", state);
    assert.equal(await response.text(), "safe asset");
  });

  it("does not accept sibling paths that share the distribution prefix", async () => {
    const { webDist, sibling } = await fixture();
    const traversal = `/../${basename(sibling)}/secret.txt`;
    assert.equal(dirname(webDist), dirname(sibling));

    const response = await serveStatic(traversal, state);

    assert.notEqual(await response.text(), "outside secret");
  });

  it("preserves the SPA fallback for missing routes", async () => {
    await fixture();
    const response = await serveStatic("/conversation/conv_test", state);
    assert.equal(await response.text(), "safe index");
  });
});
