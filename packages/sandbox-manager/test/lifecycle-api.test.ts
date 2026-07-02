import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import type { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { ManagerState } from "../src/app/manager-state.js";
import { createManagerServer } from "../src/app/server.js";

const config = {
  version: 1,
  agent: { mainModel: { provider: "anthropic", model: "claude-sonnet-4-5" } },
  controller: {
    websocket: { url: "ws://unused" },
    auth: { type: "api_key", apiKey: { env: "TOKEN" } },
  },
  secretStores: {
    defaultStore: "manager",
    stores: {
      manager: { type: "http_kv", endpoint: "https://manager.invalid" },
    },
  },
  github: {
    enabled: true,
    auth: { type: "pat", token: { kv: { key: "github-token" } } },
  },
} as const;

describe("sandbox manager lifecycle api hardening", () => {
  it("applies idempotency keys and detects conflicts", async () => {
    const storageDir = await mkdtemp(
      path.join(os.tmpdir(), "nerve-manager-idem-"),
    );
    const state = new ManagerState({
      host: "127.0.0.1",
      port: 0,
      allowRemoteBind: false,
      storageDir,
      backend: "docker",
    });
    await state.init();
    const server = createManagerServer(state);
    await listen(server);
    const address = server.address();
    assert.equal(typeof address, "object");
    const url = `http://127.0.0.1:${address && typeof address === "object" ? address.port : 0}/api/sandboxes`;
    try {
      const body = JSON.stringify({ config });
      const first = await fetch(url, {
        method: "POST",
        headers: { "Idempotency-Key": "create-1" },
        body,
      });
      assert.equal(first.status, 201);
      const second = await fetch(url, {
        method: "POST",
        headers: { "Idempotency-Key": "create-1" },
        body,
      });
      assert.equal(second.status, 200);
      assert.equal((await state.sandboxes.list()).length, 1);
      const conflict = await fetch(url, {
        method: "POST",
        headers: { "Idempotency-Key": "create-1" },
        body: JSON.stringify({
          config: { ...config, identity: { sandboxId: "sbx_other" } },
        }),
      });
      assert.equal(conflict.status, 409);
    } finally {
      await closeServer(server);
      await rm(storageDir, { recursive: true, force: true });
    }
  });

  it("enforces per-sandbox secret policy and redacted audit", async () => {
    const storageDir = await mkdtemp(
      path.join(os.tmpdir(), "nerve-manager-secret-"),
    );
    const state = new ManagerState({
      host: "127.0.0.1",
      port: 0,
      allowRemoteBind: false,
      storageDir,
      backend: "docker",
    });
    await state.init();
    const server = createManagerServer(state);
    await listen(server);
    const address = server.address();
    assert.equal(typeof address, "object");
    try {
      await state.secrets.set("github-token", "ghp_secret");
      const create = await fetch(
        `http://127.0.0.1:${address.port}/api/sandboxes`,
        { method: "POST", body: JSON.stringify({ config }) },
      );
      const record = (await create.json()).data as {
        sandboxId: string;
        controller: { token: string };
      };
      const ok = await fetch(
        `http://127.0.0.1:${address.port}/api/sandboxes/${record.sandboxId}/secrets/resolve`,
        {
          method: "POST",
          headers: { authorization: `Bearer ${record.controller.token}` },
          body: JSON.stringify({ key: "github-token" }),
        },
      );
      assert.equal(ok.status, 200);
      const forbidden = await fetch(
        `http://127.0.0.1:${address.port}/api/sandboxes/${record.sandboxId}/secrets/resolve`,
        {
          method: "POST",
          headers: { authorization: `Bearer ${record.controller.token}` },
          body: JSON.stringify({ key: "other-token" }),
        },
      );
      assert.equal(forbidden.status, 403);
      const audit = await readFile(
        path.join(storageDir, "audit", "secrets.jsonl"),
        "utf8",
      );
      assert.equal(audit.includes("github-token"), false);
      assert.equal(audit.includes("ghp_secret"), false);
    } finally {
      await closeServer(server);
      await rm(storageDir, { recursive: true, force: true });
    }
  });
});

function listen(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
}

function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
