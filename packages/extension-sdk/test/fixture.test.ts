import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { buildFixture, fixtureDist } from "../scripts/fixture.ts";

// The server's installed-extension tests load this prebuilt output; it must stay what the SDK builds.
void test("the committed server fixture equals a fresh build of the integration template", async () => {
  const { dist, cleanup } = await buildFixture();
  try {
    const backend = await readFile(join(dist, "backend.js"), "utf8");
    assert.equal(
      await readFile(join(fixtureDist, "backend.js"), "utf8"),
      backend,
      "backend.js differs; run `pnpm exec tsx scripts/fixture.ts` in packages/extension-sdk",
    );
    const fresh = JSON.parse(
      await readFile(join(dist, "manifest.json"), "utf8"),
    );
    const committed = JSON.parse(
      await readFile(join(fixtureDist, "manifest.json"), "utf8"),
    );
    // The SDK version moves with every release; the fixture stays valid while it is compatible.
    delete fresh.sdkVersion;
    delete committed.sdkVersion;
    assert.deepEqual(committed, fresh);
  } finally {
    await cleanup();
  }
});
