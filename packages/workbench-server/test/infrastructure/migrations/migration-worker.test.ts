import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { runMigrationsInWorker } from "../../../src/infrastructure/migrations/framework/worker-client.js";
import { initializeStorage } from "../../../src/infrastructure/storage-bootstrap/index.js";

describe("migration worker", () => {
  it("propagates worker progress and failure message to the caller", async () => {
    const seen: string[] = [];
    await assert.rejects(
      runMigrationsInWorker({
        home: "/unused",
        workerUrl: new URL("./stub-failure.worker.ts", import.meta.url),
        onProgress: (progress) => seen.push(progress.step),
      }),
      /Migration failure report: \/tmp\/last-failure\.json/,
    );
    assert.deepEqual(seen, ["0001-x"]);
  });

  it("initializes a fresh home through the real worker", async () => {
    const root = await mkdtemp(join(tmpdir(), "nerve-worker-"));
    try {
      const storage = await initializeStorage(join(root, "home"));
      assert.ok(storage.localToken);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
