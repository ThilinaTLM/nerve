import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Hono } from "hono";
import { createApiAuthMiddleware } from "../../../src/adapters/http/auth-middleware.js";
import { createHtmlPreviewRoutes } from "../../../src/adapters/http/routes/html-preview-routes.js";

test("authenticated lifecycle shares a public read-only capability, revocation, HEAD and safe errors", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "html-preview-route-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "demo.html"), "saved");
  await writeFile(join(root, "demo.mjs"), "export const value = 1;");
  const app = new Hono();
  app.use("/api/*", createApiAuthMiddleware("token"));
  app.route(
    "/",
    createHtmlPreviewRoutes(() => root),
  );
  const body = JSON.stringify({
    projectId: "p",
    path: "demo.html",
    text: "<h1>draft</h1>",
  });
  const create = (headers = {}) =>
    app.request("/api/filesystem/html-preview", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body,
    });
  assert.equal((await create()).status, 401);
  const response = await create({ authorization: "Bearer token" });
  assert.equal(response.status, 200);
  const { id, url } = await response.json();
  assert.match(id, /^[a-f0-9]{64}$/);
  const document = await app.request(url);
  assert.equal(document.status, 200);
  assert.match(await document.text(), /draft/);
  assert.match(
    document.headers.get("content-security-policy")!,
    /sandbox allow-scripts/,
  );
  assert.equal(document.headers.get("set-cookie"), null);
  const module = await app.request(`/html-preview/${id}/assets/demo.mjs`);
  assert.equal(module.status, 200);
  assert.equal(module.headers.get("access-control-allow-origin"), "*");
  assert.equal((await app.request(url, { method: "HEAD" })).status, 200);
  assert.equal((await app.request(url, { method: "POST" })).status, 405);
  assert.equal(
    (await app.request(`/html-preview/${id}/assets/demo.html`)).status,
    404,
  );
  assert.equal(
    (
      await app.request(`/api/filesystem/html-preview/${id}`, {
        method: "DELETE",
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await app.request(`/api/filesystem/html-preview/${id}`, {
        method: "DELETE",
        headers: { cookie: "nerve_token=token" },
      })
    ).status,
    204,
  );
  const expired = await app.request(url);
  assert.equal(expired.status, 404);
  assert.equal(expired.headers.get("set-cookie"), null);
  assert.equal(expired.headers.get("cache-control"), "no-store");
  assert.equal(
    (await create({ authorization: "Bearer token", origin: "null" })).status,
    403,
  );
});
