// Builds the `integration` template with the SDK's own build function, for the server's
// installed-extension tests (`packages/workbench-server/test/extensions/installed/sdk-fixture`).
//   pnpm exec tsx scripts/fixture.ts          # rewrite the committed fixture
// `test/fixture.test.ts` fails when the committed fixture differs from a fresh build.
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildExtension } from "../src/build.ts";
import { initExtension } from "../src/init.ts";

export const fixtureId = "sdk-probe";
export const fixtureDist = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "workbench-server",
  "test",
  "extensions",
  "installed",
  "sdk-fixture",
  fixtureId,
  "dist",
);

/** Scaffolds and builds the fixture extension in a temporary folder; returns its `dist/`. */
export async function buildFixture(): Promise<{
  dist: string;
  cleanup: () => Promise<void>;
}> {
  const root = await mkdtemp(join(tmpdir(), "nerve-sdk-fixture-"));
  const folder = await initExtension({
    id: fixtureId,
    kind: "integration",
    cwd: root,
  });
  const { distDir } = await buildExtension({ projectDir: folder });
  return {
    dist: distDir,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { dist, cleanup } = await buildFixture();
  await rm(fixtureDist, { recursive: true, force: true });
  await cp(dist, fixtureDist, { recursive: true });
  await cleanup();
  console.log(`Wrote ${fixtureDist}`);
}
