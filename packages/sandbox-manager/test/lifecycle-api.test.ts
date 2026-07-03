import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  sandboxManagerStatusSchema,
  sandboxSnapshotResultSchema,
  sandboxStatusGetResultSchema,
} from "@nervekit/shared";
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

const configWithoutController = {
  version: 1,
  agent: { mainModel: { provider: "anthropic", model: "claude-sonnet-4-5" } },
} as const;

describe("sandbox manager web ui serving and auth cookie", () => {
  it("serves the SPA shell, sets a loopback auth cookie, and accepts it", async () => {
    const storageDir = await mkdtemp(
      path.join(os.tmpdir(), "nerve-manager-web-"),
    );
    const webDist = await mkdtemp(
      path.join(os.tmpdir(), "nerve-manager-dist-"),
    );
    await writeFile(
      path.join(webDist, "index.html"),
      "<!doctype html><title>nerve sandbox manager</title>",
      "utf8",
    );
    const state = new ManagerState({
      host: "127.0.0.1",
      port: 0,
      allowRemoteBind: false,
      storageDir,
      backend: "docker",
      apiKey: "manager-secret-key",
      serveWebUi: true,
      webDist,
    });
    await state.init();
    const server = createManagerServer(state);
    await listen(server);
    const address = server.address();
    assert.equal(typeof address, "object");
    try {
      const page = await fetch(
        `http://127.0.0.1:${address.port}/sandbox-manager`,
      );
      assert.equal(page.status, 200);
      const setCookie = page.headers.get("set-cookie") ?? "";
      assert.equal(setCookie.includes("nerve_sandbox_manager_auth="), true);
      assert.equal(setCookie.includes("HttpOnly"), true);

      // Root redirects to /sandbox-manager.
      const redirect = await fetch(`http://127.0.0.1:${address.port}/`, {
        redirect: "manual",
      });
      assert.equal(redirect.status, 302);
      assert.equal(redirect.headers.get("location"), "/sandbox-manager");

      // A browser-like request presenting the cookie is authorized.
      const authed = await fetch(
        `http://127.0.0.1:${address.port}/api/manager/status`,
        {
          headers: { cookie: "nerve_sandbox_manager_auth=manager-secret-key" },
        },
      );
      assert.equal(authed.status, 200);

      // Missing hashed asset returns 404, not the SPA shell.
      const missing = await fetch(
        `http://127.0.0.1:${address.port}/assets/missing.js`,
      );
      assert.equal(missing.status, 404);
    } finally {
      await closeServer(server);
      await rm(storageDir, { recursive: true, force: true });
      await rm(webDist, { recursive: true, force: true });
    }
  });
});

describe("sandbox manager lifecycle api hardening", () => {
  it("creates a sandbox when config.controller is omitted", async () => {
    const storageDir = await mkdtemp(
      path.join(os.tmpdir(), "nerve-manager-nocontroller-"),
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
      const create = await fetch(
        `http://127.0.0.1:${address.port}/api/sandboxes`,
        {
          method: "POST",
          body: JSON.stringify({ config: configWithoutController }),
        },
      );
      assert.equal(create.status, 201);
      const record = (await create.json()).data as {
        sandboxId: string;
        controller: { token: string };
      };
      assert.equal(record.controller.token, "[REDACTED]");
      const stored = await state.sandboxes.get(record.sandboxId);
      assert.ok(stored?.controller?.token?.startsWith("ntok_"));
    } finally {
      await closeServer(server);
      await rm(storageDir, { recursive: true, force: true });
    }
  });

  it("returns manager runtime status without secret material", async () => {
    const storageDir = await mkdtemp(
      path.join(os.tmpdir(), "nerve-manager-runtime-status-"),
    );
    const state = new ManagerState({
      host: "127.0.0.1",
      port: 0,
      allowRemoteBind: false,
      storageDir,
      backend: "docker",
      apiKey: "manager-secret-key",
    });
    await state.init();
    const server = createManagerServer(state);
    await listen(server);
    const address = server.address();
    assert.equal(typeof address, "object");
    try {
      const unauthorized = await fetch(
        `http://127.0.0.1:${address.port}/api/manager/status`,
      );
      assert.equal(unauthorized.status, 401);
      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/manager/status`,
        { headers: { authorization: "Bearer manager-secret-key" } },
      );
      assert.equal(response.status, 200);
      const status = (await response.json()).data;
      assert.equal(sandboxManagerStatusSchema.safeParse(status).success, true);
      assert.equal(
        JSON.stringify(status).includes("manager-secret-key"),
        false,
      );
      assert.equal(status.backend, "docker");
      assert.equal(status.hardening.apiAuth, "configured");
    } finally {
      await closeServer(server);
      await rm(storageDir, { recursive: true, force: true });
    }
  });

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

  it("returns redacted disconnected status and snapshot contracts", async () => {
    const storageDir = await mkdtemp(
      path.join(os.tmpdir(), "nerve-manager-status-"),
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
      const create = await fetch(
        `http://127.0.0.1:${address.port}/api/sandboxes`,
        { method: "POST", body: JSON.stringify({ config }) },
      );
      const record = (await create.json()).data as { sandboxId: string };
      const statusResponse = await fetch(
        `http://127.0.0.1:${address.port}/api/sandboxes/${record.sandboxId}/status`,
      );
      const status = (await statusResponse.json()).data;
      assert.equal(status.connected, false);
      assert.equal(status.stale, true);
      assert.equal(
        sandboxStatusGetResultSchema.safeParse(status).success,
        true,
      );
      assert.equal(JSON.stringify(status).includes("ntok_"), false);

      const snapshotResponse = await fetch(
        `http://127.0.0.1:${address.port}/api/sandboxes/${record.sandboxId}/snapshot`,
      );
      const snapshot = (await snapshotResponse.json()).data;
      assert.equal(snapshot.connected, false);
      assert.equal(
        sandboxSnapshotResultSchema.safeParse(snapshot).success,
        true,
      );
      assert.equal(JSON.stringify(snapshot).includes("ntok_"), false);
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
      assert.equal(record.controller.token, "[REDACTED]");
      const stored = await state.sandboxes.get(record.sandboxId);
      assert.ok(stored?.controller?.token);
      const ok = await fetch(
        `http://127.0.0.1:${address.port}/api/sandboxes/${record.sandboxId}/secrets/resolve`,
        {
          method: "POST",
          headers: { authorization: `Bearer ${stored.controller.token}` },
          body: JSON.stringify({ key: "github-token" }),
        },
      );
      assert.equal(ok.status, 200);
      const forbidden = await fetch(
        `http://127.0.0.1:${address.port}/api/sandboxes/${record.sandboxId}/secrets/resolve`,
        {
          method: "POST",
          headers: { authorization: `Bearer ${stored.controller.token}` },
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
