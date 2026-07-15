import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { initializeStorage } from "../src/infrastructure/storage/initialize.js";
import { inspectWorkbenchHome } from "../src/infrastructure/storage/state-layout.js";

test("workbench state inspection classifies supported and incompatible layouts", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nerve-layout-inspect-"));
  const missing = path.join(root, "missing");
  const empty = path.join(root, "empty");
  const bootstrap = path.join(root, "bootstrap");
  const legacy = path.join(root, "legacy");
  const malformed = path.join(root, "malformed");
  const future = path.join(root, "future");
  try {
    await mkdir(empty);
    await mkdir(path.join(bootstrap, "logs"), { recursive: true });
    await mkdir(path.join(bootstrap, "desktop"));
    await mkdir(legacy);
    await writeFile(path.join(legacy, "config.json"), "{}\n");
    await mkdir(malformed);
    await writeFile(path.join(malformed, "VERSION"), "not-json\n");
    await mkdir(future);
    await writeFile(
      path.join(future, "VERSION"),
      `${JSON.stringify({ format: "nerve-workbench-state", version: 3 })}\n`,
    );

    assert.equal((await inspectWorkbenchHome(missing)).kind, "missing");
    assert.equal((await inspectWorkbenchHome(empty)).kind, "empty");
    assert.equal(
      (await inspectWorkbenchHome(bootstrap)).kind,
      "desktop-bootstrap",
    );
    assert.equal((await inspectWorkbenchHome(legacy)).kind, "legacy");
    assert.equal((await inspectWorkbenchHome(malformed)).kind, "unsupported");
    assert.equal((await inspectWorkbenchHome(future)).kind, "unsupported");

    await initializeStorage(empty);
    assert.equal((await inspectWorkbenchHome(empty)).kind, "current");
    await mkdir(path.join(empty, "proc", "proc_legacy"), { recursive: true });
    assert.equal((await inspectWorkbenchHome(empty)).kind, "unsupported");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

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
    await mkdir(path.join(desktopBootstrap, "desktop"));
    await writeFile(
      path.join(desktopBootstrap, "logs", "desktop-2026-07-13.jsonl"),
      "{}\n",
    );
    await writeFile(
      path.join(desktopBootstrap, "crashes", "startup.json"),
      "{}\n",
    );
    await writeFile(
      path.join(desktopBootstrap, "desktop", "Preferences"),
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
