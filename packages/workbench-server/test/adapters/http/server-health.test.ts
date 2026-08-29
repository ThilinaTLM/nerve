import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  createWorkbenchState,
  shutdownWorkbenchState,
} from "../../../src/app/runtime/server-runtime.js";
import { createApp } from "../../../src/app/server.js";
import { initializeStorage } from "../../../src/infrastructure/storage-bootstrap/index.js";

describe("server health routes", () => {
  it("keeps public and authenticated probes minimal", async () => {
    const home = await mkdtemp(join(tmpdir(), "nerve-server-health-"));
    const storage = await initializeStorage(home);
    const state = createWorkbenchState(storage, "127.0.0.1", 0);
    const app = createApp(state);

    try {
      const publicHealth = await app.request("/health");
      assert.equal(publicHealth.status, 200);
      assert.deepEqual(Object.keys(await publicHealth.json()).sort(), [
        "status",
        "version",
      ]);

      const anonymous = await app.request("/api/health");
      assert.equal(anonymous.status, 401);

      const authenticated = await app.request("/api/health", {
        headers: { authorization: `Bearer ${storage.localToken}` },
      });
      assert.equal(authenticated.status, 200);
      assert.deepEqual(Object.keys(await authenticated.json()).sort(), [
        "status",
        "version",
      ]);
    } finally {
      await shutdownWorkbenchState(state);
      await rm(home, { recursive: true, force: true });
    }
  });
});
