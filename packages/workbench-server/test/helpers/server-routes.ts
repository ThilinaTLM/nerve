import { createTestServerRuntime } from "../support/runtime-fixture.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after } from "node:test";
import {
  shutdownServerRuntime,
  type ServerRuntime,
} from "../../src/app/runtime/server-runtime.js";
import { createApp } from "../../src/app/server.js";
import { initializeStorage } from "../../src/infrastructure/storage-bootstrap/index.js";

const roots: string[] = [];
const states: ServerRuntime[] = [];

after(async () => {
  await Promise.allSettled(states.map(shutdownServerRuntime));
  await Promise.all(
    roots.map((root) =>
      rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }),
    ),
  );
});

export async function tempHome(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

export async function createAuthenticatedApp(
  host = "127.0.0.1",
  options: { applicationLogsEnabled?: boolean } = {},
) {
  const storage = await initializeStorage(
    await tempHome("nerve-server-routes-"),
  );
  const state = createTestServerRuntime(storage, host, 0, options);
  states.push(state);
  await state.logger.hydrate();
  await state.lifecycle.hydrate();
  const app = createApp(state);
  const headers = { authorization: `Bearer ${storage.localToken}` };
  return { app, state, headers };
}
