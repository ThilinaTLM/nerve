import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ensureManagerStateLayout } from "../src/state/state-layout.js";

test("manager state initializes v1 and rejects incompatible layouts", async () => {
  const empty = await mkdtemp(path.join(os.tmpdir(), "nerve-manager-v1-"));
  const legacy = await mkdtemp(path.join(os.tmpdir(), "nerve-manager-legacy-"));
  try {
    await ensureManagerStateLayout(empty);
    assert.deepEqual(
      JSON.parse(await readFile(path.join(empty, "VERSION"), "utf8")),
      {
        format: "nerve-sandbox-manager-state",
        version: 1,
      },
    );
    await writeFile(path.join(legacy, "sandboxes.json"), "[]\n");
    await assert.rejects(
      ensureManagerStateLayout(legacy),
      /Reset this directory before starting Nerve Protocol v1/,
    );
  } finally {
    await rm(empty, { recursive: true, force: true });
    await rm(legacy, { recursive: true, force: true });
  }
});
