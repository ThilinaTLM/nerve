import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after } from "node:test";
import { initializeStorage } from "../../src/infrastructure/storage/index.js";
import { createOrchestratorState } from "../../src/app/orchestrator-state.js";
import { createApp } from "../../src/app/server.js";

const roots: string[] = [];

after(async () => {
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
});

export async function tempHome(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

export async function createAuthenticatedApp(host = "127.0.0.1") {
  const storage = await initializeStorage(
    await tempHome("nerve-server-routes-"),
  );
  const state = createOrchestratorState(storage, host, 0);
  await state.logger.hydrate();
  await state.registry.hydrate();
  const app = createApp(state);
  const headers = { authorization: `Bearer ${storage.localToken}` };
  return { app, state, headers };
}
