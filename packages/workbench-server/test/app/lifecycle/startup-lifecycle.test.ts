import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createAppSwitch } from "../../../src/app/lifecycle/app-switch.js";
import { createBootApp } from "../../../src/app/lifecycle/boot-app.js";
import { createLifecycleRoutes } from "../../../src/app/lifecycle/lifecycle-routes.js";
import { createServerLifecycleHolder } from "../../../src/app/lifecycle/server-lifecycle.js";
import { createStartupSequence } from "../../../src/app/lifecycle/startup-sequence.js";
import { ensureLocalToken } from "../../../src/infrastructure/storage-bootstrap/local-token.js";
import { Hono } from "hono";

const TOKEN = "nt_test";
const auth = { authorization: `Bearer ${TOKEN}` };

function harness(storage: () => Promise<string>) {
  const holder = createServerLifecycleHolder();
  const seen: string[] = [];
  const sequence = createStartupSequence({
    holder,
    storage: async (onProgress) => {
      seen.push(holder.get().state);
      onProgress({
        step: "0001-x",
        description: "d",
        phase: "run",
        label: "Importing",
        done: 1,
        total: 2,
      });
      seen.push(holder.get().state);
      return storage();
    },
    classify: (error) => ({
      code: "MIGRATION_FAILED",
      message: String(error),
      retryable: true,
    }),
    mount: async () => undefined,
  });
  const controls = { holder, retry: () => sequence.retry() };
  const boot = createBootApp({
    ...controls,
    host: "127.0.0.1",
    port: () => 1,
    localToken: TOKEN,
  });
  return { holder, sequence, controls, boot, seen };
}

describe("server startup lifecycle", () => {
  it("goes starting → upgrading → ready", async () => {
    const h = harness(async () => "ok");
    assert.equal(h.holder.get().state, "starting");
    await h.sequence.start();
    assert.deepEqual(h.seen, ["starting", "upgrading"]);
    assert.equal(h.holder.get().state, "ready");
  });

  it("fails, retries, then becomes ready", async () => {
    let attempts = 0;
    const h = harness(async () => {
      if (++attempts === 1) throw new Error("boom");
      return "ok";
    });
    await h.sequence.start();
    assert.equal(h.holder.get().state, "failed");
    assert.equal(h.holder.get().failure?.retryable, true);

    const retry = await h.boot.request("/api/lifecycle/retry", {
      method: "POST",
      headers: auth,
    });
    assert.equal(retry.status, 202);
    for (let i = 0; i < 20 && h.holder.get().state !== "ready"; i++)
      await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(h.holder.get().state, "ready");

    const again = await h.boot.request("/api/lifecycle/retry", {
      method: "POST",
      headers: auth,
    });
    assert.equal(again.status, 409);
  });

  it("refuses retry for non-retryable failures", async () => {
    const holder = createServerLifecycleHolder();
    holder.failed({
      code: "HOME_UNSUPPORTED",
      message: "no",
      retryable: false,
    });
    const sequence = createStartupSequence({
      holder,
      storage: async () => "x",
      classify: () => ({ code: "x", message: "x", retryable: true }),
      mount: async () => undefined,
    });
    assert.equal(sequence.retry(), undefined);
  });

  it("gates the API with 503 until the full app is swapped in", async () => {
    const h = harness(async () => "ok");
    const full = new Hono();
    full.use("/api/*", async (c, next) => {
      if (c.req.header("authorization") !== auth.authorization)
        return c.json({}, 401);
      await next();
    });
    full.route("/", createLifecycleRoutes(h.controls));
    full.get("/api/projects", (c) => c.json({ projects: [] }));
    const app = createAppSwitch(h.boot);

    const blocked = await app.fetch(
      new Request("http://x/api/projects", { headers: auth }),
    );
    assert.equal(blocked.status, 503);
    const body = (await blocked.json()) as {
      error: string;
      lifecycle: { state: string };
    };
    assert.equal(body.error, "starting");
    assert.equal(body.lifecycle.state, "starting");

    assert.equal((await h.boot.request("/health")).status, 200);
    assert.equal((await h.boot.request("/api/lifecycle")).status, 401);
    assert.equal((await h.boot.request("/api/projects")).status, 401);
    const lifecycle = await h.boot.request("/api/lifecycle", { headers: auth });
    assert.equal(
      ((await lifecycle.json()) as { state: string }).state,
      "starting",
    );
    const health = await h.boot.request("/api/health", { headers: auth });
    assert.equal(
      ((await health.json()) as { lifecycle: string }).lifecycle,
      "starting",
    );

    await h.sequence.start();
    app.set(full);
    const ok = await app.fetch(
      new Request("http://x/api/projects", { headers: auth }),
    );
    assert.equal(ok.status, 200);
    const ready = await app.fetch(
      new Request("http://x/api/lifecycle", { headers: auth }),
    );
    assert.equal(((await ready.json()) as { state: string }).state, "ready");
    assert.equal(
      (await app.fetch(new Request("http://x/api/lifecycle"))).status,
      401,
    );
  });
});

describe("local token before migration", () => {
  it("creates a 0600 token for a fresh home and keeps it fresh", async () => {
    const root = await mkdtemp(join(tmpdir(), "nerve-token-"));
    const home = join(root, "home");
    try {
      const first = await ensureLocalToken(home);
      assert.ok(first.ok);
      const mode =
        (await stat(join(home, "secrets", "daemon-token"))).mode & 0o777;
      assert.equal(mode, 0o600);
      const second = await ensureLocalToken(home);
      assert.deepEqual(second, first);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("errors on an existing home without a token and on unsupported homes", async () => {
    const root = await mkdtemp(join(tmpdir(), "nerve-token-"));
    try {
      const legacy = join(root, "legacy");
      await mkdir(legacy);
      await writeFile(
        join(legacy, "manifest.json"),
        JSON.stringify({ format: "nerve-home", version: 1 }),
      );
      const missing = await ensureLocalToken(legacy);
      assert.equal(missing.ok, false);
      assert.equal(!missing.ok && missing.code, "TOKEN_MISSING");

      const foreign = join(root, "foreign");
      await mkdir(foreign);
      await writeFile(join(foreign, "something"), "x");
      const unsupported = await ensureLocalToken(foreign);
      assert.equal(!unsupported.ok && unsupported.code, "HOME_UNSUPPORTED");
      await assert.rejects(stat(join(foreign, "secrets")));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
