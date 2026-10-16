import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { defaultUserConfiguration } from "@nervekit/contracts/settings";
import {
  HomeConfigurationInvalidError,
  initializeHomeConfiguration,
  readHomeConfiguration,
  resetHomeConfigurationDocuments,
} from "../../../src/infrastructure/configuration/home-configuration.js";
import { storagePaths } from "../../../src/infrastructure/storage-bootstrap/paths.js";

void test("reports every invalid home document and resets chosen ones to defaults", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-config-reset-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const paths = storagePaths(home);
  await initializeHomeConfiguration(paths);
  await writeFile(paths.harnessConfigPath, "{ broken");
  await writeFile(paths.uiConfigPath, JSON.stringify({ version: 99 }));

  const error = await readHomeConfiguration(paths).then(
    () => assert.fail("expected invalid configuration"),
    (caught: unknown) => caught,
  );
  assert(error instanceof HomeConfigurationInvalidError);
  assert.deepEqual(
    error.documents.map((document) => document.path),
    [paths.harnessConfigPath, paths.uiConfigPath],
  );
  assert.match(error.documents[0].reason, /JSON/);

  await assert.rejects(
    resetHomeConfigurationDocuments(paths, [join(home, "config/mcp.json")]),
    /Not a Nerve configuration document/,
  );
  await resetHomeConfigurationDocuments(paths, [
    paths.harnessConfigPath,
    paths.uiConfigPath,
  ]);
  const configuration = await readHomeConfiguration(paths);
  assert.deepEqual(configuration.harness, defaultUserConfiguration.harness);
  // The invalid bytes stay beside the reset document.
  const aside = (await readdir(paths.configPath)).filter((name) =>
    name.startsWith("harness.json.invalid-"),
  );
  assert.equal(aside.length, 1);
  assert.equal(
    await readFile(join(paths.configPath, aside[0]), "utf8"),
    "{ broken",
  );
});
