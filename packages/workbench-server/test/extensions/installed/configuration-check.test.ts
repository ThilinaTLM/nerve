// `configuration.check` for extensions reads the folders on disk, so a fix shows before a reload.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { extensionProvider } from "../../../src/core-host/configuration/providers/extension-provider.js";
import { createTestCatalog, writeExtension } from "./fixtures.js";

void test("check reports the folder on disk: a broken manifest, then a fix that still needs a reload", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-ext-check-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const root = join(home, "agent", "extensions");
  await writeExtension(root, { id: "probe" }, (manifest) => {
    manifest.unexpected = true;
  });
  const catalog = createTestCatalog({ home });
  const provider = extensionProvider({ catalog, home });
  const context = { scope: "user" as const };

  const [broken] = await provider.check(context);
  assert.equal(broken.state, "invalid");
  assert.match(broken.diagnostics[0].message, /unexpected/);

  // The fix is on disk; the catalog still holds the broken version.
  await writeExtension(root, { id: "probe" });
  const [fixed] = await provider.check(context);
  assert.deepEqual(
    fixed.diagnostics.map((entry) => entry.code),
    ["reload-needed"],
  );

  // After a reload the loaded version matches the disk; only consent is left.
  const reloaded = await provider.reload(context);
  assert.deepEqual(
    reloaded.map((entry) => entry.state),
    ["needs_review"],
  );
  assert.deepEqual(
    (await provider.check(context)).map((entry) => entry.state),
    ["needs_review"],
  );
});
