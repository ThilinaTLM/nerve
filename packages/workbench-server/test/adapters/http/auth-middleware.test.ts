import assert from "node:assert/strict";
import { test } from "node:test";
import { Hono } from "hono";
import { createApiAuthMiddleware } from "../../../src/adapters/http/auth-middleware.js";

test("rejects opaque and cross-site browser traffic before cookie or injected bearer authorization", async () => {
  const app = new Hono();
  app.use("/api/*", createApiAuthMiddleware("token"));
  app.get("/api/test", (c) => c.text("ok"));
  for (const credentials of [
    { authorization: "Bearer token" },
    { cookie: "nerve_token=token" },
  ]) {
    for (const headers of [
      { origin: "null" },
      { origin: "null", "sec-fetch-site": "same-origin" },
      { "sec-fetch-site": "cross-site", "sec-fetch-dest": "script" },
      { "sec-fetch-site": "cross-site", "sec-fetch-dest": "image" },
      { "sec-fetch-site": "cross-site", "sec-fetch-dest": "document" },
      { "sec-fetch-site": "cross-site", "sec-fetch-dest": "empty" },
      { "sec-fetch-site": "same-site", "sec-fetch-dest": "script" },
      { origin: "https://untrusted.test" },
    ]) {
      assert.equal(
        (
          await app.request("/api/test", {
            headers: { ...credentials, ...headers },
          })
        ).status,
        403,
      );
    }
    for (const headers of [
      {},
      { "sec-fetch-site": "same-origin", origin: "http://localhost" },
      { "sec-fetch-site": "same-origin", origin: "https://trusted-proxy.test" },
      { "sec-fetch-site": "none", "sec-fetch-dest": "document" },
    ]) {
      const response = await app.request("/api/test", {
        headers: { ...credentials, ...headers },
      });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("access-control-allow-origin"), null);
    }
  }
  assert.equal((await app.request("/api/test")).status, 401);
});
