import assert from "node:assert/strict";
import { createTestCatalog } from "./fixtures.js";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { sandbox } from "@nervekit/native";
import { loadInstalledExtension } from "../../../src/core-host/extension-catalog/load-installed.js";
import { readInstalledExtensions } from "../../../src/core-host/extension-catalog/read-installed.js";
import { overrideTrustGate } from "../../../src/core-host/extension-catalog/trust-gate.js";

/*
 * `sdk-fixture/sdk-probe/dist` is what `nerve-ext build` writes for the `integration` template
 * (packages/extension-sdk/scripts/fixture.ts; the SDK's own tests keep it current). The host's
 * reader and loader must accept the SDK's output as is.
 */

const NERVE = "0.41.1";
const fixtureRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "sdk-fixture",
);
const skip = !sandbox.isPersistentAvailable();

let temp = "";
before(async () => {
  temp = await mkdtemp(join(tmpdir(), "sdk-built-"));
});
after(async () => {
  await rm(temp, { recursive: true, force: true });
});

void test("the reader accepts the SDK's manifest", async () => {
  const [read] = await readInstalledExtensions(fixtureRoot, NERVE);
  assert.deepEqual(read.diagnostics, []);
  assert.equal(read.manifest?.id, "sdk-probe");
  assert.equal(read.incompatible, undefined);
  assert.deepEqual(read.icon, { type: "lucide", name: "globe" });
});

void test(
  "the SDK's backend registers exactly the definition its manifest describes",
  { skip },
  async () => {
    const [read] = await readInstalledExtensions(fixtureRoot, NERVE);
    const loaded = await loadInstalledExtension(read.folder, read.manifest!);
    assert.ok(!("error" in loaded), "error" in loaded ? loaded.error : "");
    assert.equal(loaded.definition.namespaces[0]?.id, "sdkProbe");
  },
);

void test(
  "the catalog composes the SDK-built extension into the registry",
  { skip },
  async () => {
    const home = join(temp, "home");
    await mkdir(join(home, "agent", "extensions"), { recursive: true });
    await cp(
      join(fixtureRoot, "sdk-probe"),
      join(home, "agent", "extensions", "sdk-probe"),
      { recursive: true },
    );
    const catalog = createTestCatalog({
      home,
      trustGate: overrideTrustGate(),
    });
    const registry = await catalog.registryFor();
    assert.ok(registry.extensions.some((entry) => entry.id === "sdk-probe"));
  },
);
