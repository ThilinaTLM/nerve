import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  expectedNativePrebuilds,
  nativePrebuildFilename,
  verifyNativePrebuilds,
  workerPrebuildFilename,
} from "./native-prebuilds.mjs";

const targets = [
  "x86_64-unknown-linux-gnu",
  "aarch64-unknown-linux-gnu",
  "x86_64-pc-windows-msvc",
  "aarch64-pc-windows-msvc",
  "x86_64-apple-darwin",
  "aarch64-apple-darwin",
];

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "nerve-native-prebuilds-"));
  await mkdir(join(root, "packages", "native"), { recursive: true });
  await writeFile(
    join(root, "packages", "native", "package.json"),
    `${JSON.stringify({ napi: { targets } }, null, 2)}\n`,
  );
  const directory = join(root, "prebuilds");
  await mkdir(directory);
  return { root, directory };
}

test("maps supported Rust targets to napi filenames", () => {
  assert.deepEqual(targets.map(nativePrebuildFilename), [
    "nerve_native.linux-x64-gnu.node",
    "nerve_native.linux-arm64-gnu.node",
    "nerve_native.win32-x64-msvc.node",
    "nerve_native.win32-arm64-msvc.node",
    "nerve_native.darwin-x64.node",
    "nerve_native.darwin-arm64.node",
  ]);
  assert.throws(
    () => nativePrebuildFilename("x86_64-unknown-linux-musl"),
    /Unsupported native release target/,
  );
});

test("maps supported Rust targets to worker filenames", () => {
  assert.deepEqual(targets.map(workerPrebuildFilename), [
    "nerve_execution_worker.linux-x64-gnu",
    "nerve_execution_worker.linux-arm64-gnu",
    "nerve_execution_worker.win32-x64-msvc.exe",
    "nerve_execution_worker.win32-arm64-msvc.exe",
    "nerve_execution_worker.darwin-x64",
    "nerve_execution_worker.darwin-arm64",
  ]);
});

test("accepts exactly the declared release prebuilds", async (context) => {
  const { root, directory } = await createFixture();
  context.after(() => rm(root, { recursive: true, force: true }));
  const expected = await expectedNativePrebuilds(root);
  await Promise.all(
    expected.map((name) => writeFile(join(directory, name), "fixture")),
  );

  assert.deepEqual(
    await verifyNativePrebuilds(directory, root),
    expected.sort(),
  );
});

test("rejects missing, extra, and local prebuild entries", async (context) => {
  const { root, directory } = await createFixture();
  context.after(() => rm(root, { recursive: true, force: true }));
  const expected = await expectedNativePrebuilds(root);
  await Promise.all(
    expected
      .slice(1)
      .map((name) => writeFile(join(directory, name), "fixture")),
  );
  await assert.rejects(
    verifyNativePrebuilds(directory, root),
    /must contain exactly/,
  );

  await writeFile(join(directory, expected[0]), "fixture");
  await writeFile(join(directory, "unexpected.node"), "fixture");
  await assert.rejects(
    verifyNativePrebuilds(directory, root),
    /unexpected\.node/,
  );

  await rm(join(directory, "unexpected.node"));
  await mkdir(join(directory, "local"));
  await assert.rejects(verifyNativePrebuilds(directory, root), / {2}local/);
});
