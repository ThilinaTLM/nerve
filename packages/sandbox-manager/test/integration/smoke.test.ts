import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import type { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { promisify } from "node:util";
import { ManagerState } from "../../src/app/manager-state.js";
import { createManagerServer } from "../../src/app/server.js";

const execFileAsync = promisify(execFile);

const smokeConfig = {
  version: 1,
  agent: { mainModel: { provider: "anthropic", model: "claude-sonnet-4-5" } },
  controller: {
    websocket: { url: "ws://unused" },
    auth: { type: "api_key", apiKey: { env: "TOKEN" } },
    disconnectPolicy: { mode: "exit_self", exitAfterMs: 60_000 },
  },
} as const;

describe("guarded docker/podman sandbox smoke", () => {
  it("skips clearly when no container backend is available", async (t) => {
    const backend = await availableBackend();
    if (!backend) {
      t.skip(
        "Docker/Podman backend unavailable; guarded sandbox smoke skipped",
      );
      return;
    }
    // Full container smoke is intentionally guarded and configured by operators;
    // this assertion proves backend detection happens at runtime, not import time.
    await execFileAsync(backend, ["version"], { timeout: 10_000 });
  });

  it("runs an opt-in create/start/connect/status/cleanup smoke", async (t) => {
    const image = process.env.NERVE_SANDBOX_AGENT_SMOKE_IMAGE?.trim();
    if (!image) {
      t.skip("NERVE_SANDBOX_AGENT_SMOKE_IMAGE is not configured");
      return;
    }
    const backend = await availableBackend();
    if (!backend) {
      t.skip("Docker/Podman backend unavailable");
      return;
    }
    try {
      await execFileAsync(backend, ["image", "inspect", image], {
        timeout: 10_000,
      });
    } catch {
      t.skip(`Sandbox smoke image is not available locally: ${image}`);
      return;
    }
    const storageDir = await mkdtemp(
      path.join(os.tmpdir(), "nerve-manager-e2e-smoke-"),
    );
    const port = await freePort();
    const publicUrl = publicManagerUrl(port);
    const oldPublicUrl = process.env.NERVE_SANDBOX_MANAGER_PUBLIC_URL;
    process.env.NERVE_SANDBOX_MANAGER_PUBLIC_URL = publicUrl;
    const state = new ManagerState({
      host: "0.0.0.0",
      port,
      allowRemoteBind: true,
      storageDir,
      backend,
      mode: "development",
      allowCleartextSecretsInDevelopment: true,
    });
    await state.init();
    const server = createManagerServer(state);
    await listen(server, port);
    let sandboxId: string | undefined;
    try {
      const base = `http://127.0.0.1:${port}`;
      const create = await fetch(`${base}/api/sandboxes`, {
        method: "POST",
        body: JSON.stringify({ config: smokeConfig, image }),
      });
      assert.equal(create.status, 201);
      const record = (await create.json()).data as {
        sandboxId: string;
        controller?: { token?: string };
      };
      sandboxId = record.sandboxId;
      assert.equal(record.controller?.token, "[REDACTED]");
      const start = await fetch(`${base}/api/sandboxes/${sandboxId}/start`, {
        method: "POST",
        headers: { "Idempotency-Key": `start-${sandboxId}` },
        body: "{}",
      });
      assert.equal(start.status, 200);
      await waitForConnectedStatus(base, sandboxId, 60_000);
      const command = await fetch(
        `${base}/api/sandboxes/${sandboxId}/commands`,
        {
          method: "POST",
          body: JSON.stringify({ method: "sandbox.status.get", params: {} }),
        },
      );
      assert.equal(command.status, 200);
      const commandPayload = await command.json();
      assert.equal(JSON.stringify(commandPayload).includes("ntok_"), false);
    } finally {
      if (sandboxId) {
        await fetch(
          `http://127.0.0.1:${port}/api/sandboxes/${sandboxId}/stop`,
          {
            method: "POST",
            body: "{}",
          },
        ).catch(() => undefined);
        await fetch(
          `http://127.0.0.1:${port}/api/sandboxes/${sandboxId}?force=1&removeVolumes=1`,
          { method: "DELETE" },
        ).catch(() => undefined);
      }
      await closeServer(server);
      await rm(storageDir, { recursive: true, force: true });
      if (oldPublicUrl === undefined)
        delete process.env.NERVE_SANDBOX_MANAGER_PUBLIC_URL;
      else process.env.NERVE_SANDBOX_MANAGER_PUBLIC_URL = oldPublicUrl;
    }
  });
});

async function availableBackend(): Promise<"docker" | "podman" | undefined> {
  for (const bin of ["docker", "podman"] as const) {
    try {
      await execFileAsync(bin, ["version"], { timeout: 5_000 });
      return bin;
    } catch {}
  }
  return undefined;
}

async function waitForConnectedStatus(
  base: string,
  sandboxId: string,
  timeoutMs: number,
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const response = await fetch(`${base}/api/sandboxes/${sandboxId}/status`);
    if (response.ok) {
      const payload = (await response.json()) as {
        data?: { connected?: boolean; status?: string };
      };
      if (payload.data?.connected && payload.data.status === "ready") return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Timed out waiting for sandbox daemon connection");
}

function publicManagerUrl(port: number): string {
  const configured =
    process.env.NERVE_SANDBOX_AGENT_SMOKE_MANAGER_PUBLIC_URL?.trim();
  if (configured) return configured.replace("{port}", String(port));
  return `ws://host.docker.internal:${port}`;
}

function listen(
  server: ReturnType<typeof createServer>,
  port: number,
): Promise<void> {
  return new Promise((resolve) => server.listen(port, "0.0.0.0", resolve));
}

function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address !== "object") {
        server.close(() => reject(new Error("Unable to allocate port")));
        return;
      }
      const port = address.port;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
    server.on("error", reject);
  });
}
