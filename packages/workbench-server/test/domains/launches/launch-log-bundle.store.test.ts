import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { LaunchLogBundleStore } from "../../../src/domains/launches/persistence/launch-log-bundle.store.js";

const roots: string[] = [];
afterEach(async () =>
  Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  ),
);

describe("LaunchLogBundleStore", () => {
  it("migrates legacy JSONL into distinct reconstructed streams idempotently", async () => {
    const root = await mkdtemp(join(tmpdir(), "nerve-launch-bundle-"));
    roots.push(root);
    const launchId = "launch_legacy";
    const legacy = join(root, `${launchId}.logs.jsonl`);
    await writeFile(
      legacy,
      `${JSON.stringify({ seq: 1, ts: "2026-08-27T00:00:00.000Z", stream: "stdout", level: "info", line: "out" })}\n${JSON.stringify({ seq: 2, ts: "2026-08-27T00:00:01.000Z", stream: "stderr", level: "error", line: "err" })}\n`,
    );
    const store = new LaunchLogBundleStore(root);
    await store.migrateLegacy(launchId);
    const paths = store.paths(launchId);
    assert.equal(await readFile(paths.stdoutPath, "utf8"), "out\n");
    assert.equal(await readFile(paths.stderrPath, "utf8"), "err\n");
    const events = (await readFile(paths.eventsPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { raw: { fidelity: string } });
    assert.deepEqual(
      events.map((event) => event.raw.fidelity),
      ["reconstructed", "reconstructed"],
    );
    assert.equal(
      await access(paths.combinedPath)
        .then(() => true)
        .catch(() => false),
      false,
    );

    await store.migrateLegacy(launchId);
    assert.equal(await readFile(paths.stdoutPath, "utf8"), "out\n");
  });

  it("reconciles abandoned tombstones and orphan bundles", async () => {
    const root = await mkdtemp(join(tmpdir(), "nerve-launch-bundle-"));
    roots.push(root);
    const store = new LaunchLogBundleStore(root);
    const valid = await store.initializeLaunch("launch_valid");
    await writeFile(valid.eventsPath, "");
    const orphan = await store.initializeLaunch("launch_orphan");
    await writeFile(orphan.eventsPath, "");
    await store.reconcile(new Set(["launch_valid"]));
    assert.equal(
      await access(valid.dir)
        .then(() => true)
        .catch(() => false),
      true,
    );
    assert.equal(
      await access(orphan.dir)
        .then(() => true)
        .catch(() => false),
      false,
    );
  });
});
