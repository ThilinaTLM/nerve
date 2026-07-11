import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { initializeStorage } from "../src/infrastructure/storage/initialize.js";

test("workbench state initializes v1 and rejects incompatible layouts", async () => {
  const empty = await mkdtemp(path.join(os.tmpdir(), "nerve-layout-v1-"));
  const legacy = await mkdtemp(path.join(os.tmpdir(), "nerve-layout-legacy-"));
  try {
    await initializeStorage(empty);
    assert.deepEqual(
      JSON.parse(await readFile(path.join(empty, "VERSION"), "utf8")),
      {
        format: "nerve-workbench-state",
        version: 1,
      },
    );
    await writeFile(path.join(legacy, "config.json"), "{}\n");
    await assert.rejects(
      initializeStorage(legacy),
      new RegExp(`Reset this directory before starting Nerve Protocol v1`),
    );
  } finally {
    await rm(empty, { recursive: true, force: true });
    await rm(legacy, { recursive: true, force: true });
  }
});
