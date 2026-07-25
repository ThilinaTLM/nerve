import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import type { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { ManagerState } from "../src/app/manager-state.js";
import { createManagerServer } from "../src/app/server.js";
import type { ContainerRuntimeDriver } from "../src/drivers/container-runtime-driver.js";

const config = {
  version: 1,
  agent: {
    defaultModel: { provider: "anthropic", model: "claude-sonnet-4-5" },
  },
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
  agent: {
    defaultModel: { provider: "anthropic", model: "claude-sonnet-4-5" },
  },
} as const;

const postgresUrl = process.env.NERVE_TEST_POSTGRES_URL;
const describeWithPostgres = postgresUrl ? describe : describe.skip;

describeWithPostgres(
  "sandbox manager web ui serving and auth cookie",
  () => {},
);

describeWithPostgres("sandbox manager lifecycle api hardening", () => {
  it("returns the persisted failed record when automatic startup fails", async () => {
    const storageDir = await mkdtemp(
      path.join(os.tmpdir(), "nerve-manager-start-failure-"),
    );
    const state = testManagerState(
      {
        host: "127.0.0.1",
        port: 0,
        allowRemoteBind: false,
        storageDir,
        backend: "docker",
        databaseUrl: postgresUrl,
        databaseSsl: false,
        volumeBackend: "local",
      },
      { failStart: true },
    );
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
          headers: { "Idempotency-Key": "create-start-failure" },
          body: JSON.stringify({ config: configWithoutController }),
        },
      );
      assert.equal(create.status, 201);
      const record = (await create.json()).data as {
        sandboxId: string;
        desiredState: string;
        observedState: string;
        lifecycleState: string;
        lastError?: { code?: string; message?: string };
      };
      assert.equal(record.desiredState, "running");
      assert.equal(record.observedState, "failed");
      assert.equal(record.lifecycleState, "failed");
      assert.equal(record.lastError?.code, "START_FAILED");
      assert.match(record.lastError?.message ?? "", /failed to start/);

      const replay = await fetch(
        `http://127.0.0.1:${address.port}/api/sandboxes`,
        {
          method: "POST",
          headers: { "Idempotency-Key": "create-start-failure" },
          body: JSON.stringify({ config: configWithoutController }),
        },
      );
      assert.equal(replay.status, 200);
      assert.equal((await replay.json()).data.sandboxId, record.sandboxId);
    } finally {
      await closeServer(server);
      await rm(storageDir, { recursive: true, force: true });
    }
  });

  it("rejects malformed and oversized JSON bodies", async () => {
    const storageDir = await mkdtemp(
      path.join(os.tmpdir(), "nerve-manager-body-"),
    );
    const state = testManagerState({
      host: "127.0.0.1",
      port: 0,
      allowRemoteBind: false,
      storageDir,
      backend: "docker",
      databaseUrl: postgresUrl,
      databaseSsl: false,
      volumeBackend: "local",
    });
    await state.init();
    const server = createManagerServer(state);
    await listen(server);
    const address = server.address();
    assert.equal(typeof address, "object");
    const url = `http://127.0.0.1:${address.port}/api/sandboxes`;
    try {
      const malformed = await fetch(url, { method: "POST", body: "{" });
      assert.equal(malformed.status, 400);
      assert.equal((await malformed.json()).error.code, "VALIDATION_FAILED");

      const oversized = await fetch(url, {
        method: "POST",
        body: "x".repeat(1024 * 1024 + 1),
      });
      assert.equal(oversized.status, 413);
      assert.equal((await oversized.json()).error.code, "REQUEST_TOO_LARGE");
    } finally {
      await closeServer(server);
      await rm(storageDir, { recursive: true, force: true });
    }
  });

  it("applies idempotency keys and detects conflicts", async () => {
    const storageDir = await mkdtemp(
      path.join(os.tmpdir(), "nerve-manager-idem-"),
    );
    const state = testManagerState({
      host: "127.0.0.1",
      port: 0,
      allowRemoteBind: false,
      storageDir,
      backend: "docker",
      databaseUrl: postgresUrl,
      databaseSsl: false,
      volumeBackend: "local",
    });
    await state.init();
    const server = createManagerServer(state);
    await listen(server);
    const address = server.address();
    assert.equal(typeof address, "object");
    const url = `http://127.0.0.1:${address && typeof address === "object" ? address.port : 0}/api/sandboxes`;
    try {
      const initialSandboxCount = (await state.sandboxes.list()).length;
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
      assert.equal(
        (await state.sandboxes.list()).length,
        initialSandboxCount + 1,
      );
      const conflict = await fetch(url, {
        method: "POST",
        headers: { "Idempotency-Key": "create-1" },
        body: JSON.stringify({
          config,
          launch: { sandboxId: "sbx_other" },
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
    const state = testManagerState({
      host: "127.0.0.1",
      port: 0,
      allowRemoteBind: false,
      storageDir,
      backend: "docker",
      databaseUrl: postgresUrl,
      databaseSsl: false,
      volumeBackend: "local",
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

function testManagerState(
  config: ConstructorParameters<typeof ManagerState>[0],
  options: { failStart?: boolean } = {},
): ManagerState {
  return new ManagerState(
    {
      ...config,
      defaultSandboxImage:
        config.defaultSandboxImage ?? "nerve-sandbox-agent:dev",
    },
    { driver: testDriver(options) },
  );
}

function testDriver(
  options: { failStart?: boolean } = {},
): ContainerRuntimeDriver {
  return {
    kind: "docker",
    capabilities: async () => ({
      kind: "docker",
      available: true,
      version: "test",
      supportsReadOnlyRootFilesystem: true,
      supportsNoNewPrivileges: true,
      supportsPidsLimit: true,
      supportsCpuLimit: true,
      supportsMemoryLimit: true,
      supportsTmpfs: true,
      limitations: [],
    }),
    create: async (spec) => ({
      kind: "docker",
      id: `container-${spec.sandboxId}`,
      name: `nerve-${spec.sandboxId}`,
    }),
    start: async () => {
      if (options.failStart) throw new Error("test runtime failed to start");
    },
    inspect: async (ref) => ({ ref, state: "running" }),
    logs: () => ({
      async *[Symbol.asyncIterator]() {
        // The lifecycle API tests do not need runtime log output.
      },
    }),
    stop: async () => {},
    kill: async () => {},
    remove: async () => {},
  };
}

function listen(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
}

function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
