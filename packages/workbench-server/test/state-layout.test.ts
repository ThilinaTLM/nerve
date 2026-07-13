import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { initializeStorage } from "../src/infrastructure/storage/initialize.js";

test("workbench state initializes v2 and rejects incompatible layouts", async () => {
  const empty = await mkdtemp(path.join(os.tmpdir(), "nerve-layout-v2-"));
  const desktopBootstrap = await mkdtemp(
    path.join(os.tmpdir(), "nerve-layout-desktop-"),
  );
  const legacy = await mkdtemp(path.join(os.tmpdir(), "nerve-layout-legacy-"));
  try {
    await initializeStorage(empty);
    assert.deepEqual(
      JSON.parse(await readFile(path.join(empty, "VERSION"), "utf8")),
      {
        format: "nerve-workbench-state",
        version: 2,
      },
    );
    await mkdir(path.join(empty, "proc", "proc_legacy"), {
      recursive: true,
    });
    await assert.rejects(
      initializeStorage(empty),
      /Reset this directory before starting Nerve Protocol v1/,
    );

    await mkdir(path.join(desktopBootstrap, "logs"));
    await mkdir(path.join(desktopBootstrap, "crashes"));
    await writeFile(
      path.join(desktopBootstrap, "logs", "desktop-2026-07-13.jsonl"),
      "{}\n",
    );
    await writeFile(
      path.join(desktopBootstrap, "crashes", "startup.json"),
      "{}\n",
    );
    await initializeStorage(desktopBootstrap);
    assert.deepEqual(
      JSON.parse(
        await readFile(path.join(desktopBootstrap, "VERSION"), "utf8"),
      ),
      {
        format: "nerve-workbench-state",
        version: 2,
      },
    );

    await writeFile(path.join(legacy, "config.json"), "{}\n");
    await assert.rejects(
      initializeStorage(legacy),
      new RegExp(`Reset this directory before starting Nerve Protocol v1`),
    );
  } finally {
    await rm(empty, { recursive: true, force: true });
    await rm(desktopBootstrap, { recursive: true, force: true });
    await rm(legacy, { recursive: true, force: true });
  }
});
