import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  renderStorageReadCompatibility,
  storageReadCompatibilityId,
  storageReadCompatibilityPolicyViolations,
  updateStorageReadCompatibility,
} from "../storage-read-compatibility.mjs";

function write(root, path, content) {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "nerve-reader-compatibility-"));
  write(
    root,
    "packages/workbench-server/package.json",
    JSON.stringify({
      name: "@nervekit/workbench-server",
      version: "1.0.0",
      dependencies: { "@nervekit/contracts": "workspace:*", zod: "4.1.12" },
    }),
  );
  write(
    root,
    "packages/contracts/package.json",
    JSON.stringify({
      name: "@nervekit/contracts",
      version: "1.0.0",
      dependencies: { zod: "4.1.12" },
      exports: { "./tools": { import: "./dist/domains/tools/index.js" } },
    }),
  );
  write(
    root,
    "packages/workbench-server/src/infrastructure/persistence/payloads/descriptors.ts",
    'import "./codec.js"; import "@nervekit/contracts/tools"; export const readers = 1;\n',
  );
  write(
    root,
    "packages/workbench-server/src/infrastructure/persistence/payloads/codec.ts",
    'import { z } from "zod"; export const codec = z.string();\n',
  );
  write(
    root,
    "packages/workbench-server/src/infrastructure/storage-migrations/runner/payload-sweep.ts",
    'import "../../persistence/payloads/descriptors.js"; export const sweep = true;\n',
  );
  write(
    root,
    "packages/contracts/src/domains/tools/index.ts",
    'export * from "./records.js";\n',
  );
  write(
    root,
    "packages/contracts/src/domains/tools/records.ts",
    "export const persistedSchema = 1;\n",
  );
  return root;
}

test("storage reader fingerprint follows reader sources and validator versions", () => {
  const root = fixture();
  try {
    const original = storageReadCompatibilityId(root);
    write(
      root,
      "packages/contracts/src/domains/tools/records.ts",
      "export const persistedSchema = 2;\n",
    );
    const sourceChanged = storageReadCompatibilityId(root);
    assert.notEqual(sourceChanged, original);

    const manifestPath = join(root, "packages/contracts/package.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.version = "2.0.0";
    writeFileSync(manifestPath, JSON.stringify(manifest));
    assert.equal(storageReadCompatibilityId(root), sourceChanged);

    const serverManifestPath = join(
      root,
      "packages/workbench-server/package.json",
    );
    const serverManifest = JSON.parse(readFileSync(serverManifestPath, "utf8"));
    serverManifest.dependencies.zod = "4.2.0";
    writeFileSync(serverManifestPath, JSON.stringify(serverManifest));
    assert.notEqual(storageReadCompatibilityId(root), sourceChanged);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("generated compatibility output is deterministic and policy checked", () => {
  const root = fixture();
  try {
    assert.equal(
      renderStorageReadCompatibility(root),
      renderStorageReadCompatibility(root),
    );
    assert.match(storageReadCompatibilityPolicyViolations(root)[0], /missing/);
    const output = updateStorageReadCompatibility(root);
    assert.deepEqual(storageReadCompatibilityPolicyViolations(root), []);
    writeFileSync(output, "stale\n");
    assert.match(storageReadCompatibilityPolicyViolations(root)[0], /stale/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("unresolved workspace exports fail closed", () => {
  const root = fixture();
  try {
    const manifestPath = join(root, "packages/contracts/package.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.exports = {};
    writeFileSync(manifestPath, JSON.stringify(manifest));
    assert.throws(
      () => storageReadCompatibilityId(root),
      /no resolvable package export/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
