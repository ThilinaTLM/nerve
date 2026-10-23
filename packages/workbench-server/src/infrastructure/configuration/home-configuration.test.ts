import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { storagePaths } from "../storage-bootstrap/paths.js";
import {
  initializeHomeConfiguration,
  readHomeConfiguration,
  writeHomeConfiguration,
} from "./home-configuration.js";

void test("preserved home configuration neither reads nor recreates retired harness documents", async () => {
  const home = await mkdtemp(join(tmpdir(), "nerve-home-configuration-"));
  try {
    const paths = storagePaths(home);
    const configuration = await initializeHomeConfiguration(paths);
    await assert.rejects(access(join(paths.configPath, "harness.json")));
    await writeFile(
      join(paths.configPath, "harness.json"),
      "invalid retired bytes",
    );
    const loaded = await readHomeConfiguration(paths);
    assert.deepEqual(loaded, configuration);
    loaded.ui.appearance.zoomLevel = 2;
    await writeHomeConfiguration(paths, loaded, ["ui"]);
    assert.equal(
      (await readHomeConfiguration(paths)).ui.appearance.zoomLevel,
      2,
    );
    assert.equal(
      await readFile(join(paths.configPath, "harness.json"), "utf8"),
      "invalid retired bytes",
    );
    await rm(join(paths.configPath, "harness.json"));
    await initializeHomeConfiguration(paths);
    await assert.rejects(access(join(paths.configPath, "harness.json")));
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
