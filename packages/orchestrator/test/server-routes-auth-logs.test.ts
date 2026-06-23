import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAuthenticatedApp } from "./helpers/server-routes.js";

describe("orchestrator server auth and logs", () => {
  it("accepts and queries application logs", async () => {
    const { app, state, headers } = await createAuthenticatedApp();
    try {
      const writeResponse = await app.request("/api/logs/client", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          logs: [
            {
              level: "error",
              component: "test-client",
              message: "client exploded",
              context: { token: "secret" },
            },
          ],
        }),
      });
      assert.equal(writeResponse.status, 200);

      const readResponse = await app.request("/api/logs?level=error", {
        headers,
      });
      assert.equal(readResponse.status, 200);
      const body = (await readResponse.json()) as {
        logs: Array<{
          source: string;
          component: string;
          context?: Record<string, unknown>;
        }>;
      };
      assert.ok(
        body.logs.some(
          (log) => log.source === "web" && log.component === "test-client",
        ),
      );

      const pruneResponse = await app.request("/api/logs/prune", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ source: "web", component: "test-client" }),
      });
      assert.equal(pruneResponse.status, 200);
      const pruneBody = (await pruneResponse.json()) as {
        pruned: number;
        remaining: number;
      };
      assert.equal(pruneBody.pruned, 1);

      const afterPruneResponse = await app.request(
        "/api/logs?source=web&component=test-client",
        { headers },
      );
      assert.equal(afterPruneResponse.status, 200);
      const afterPrune = (await afterPruneResponse.json()) as {
        logs: Array<{ source: string; component: string }>;
      };
      assert.equal(afterPrune.logs.length, 0);
    } finally {
      state.index.close();
    }
  });

  it("requires local auth for core API routes", async () => {
    const { app, state } = await createAuthenticatedApp();
    try {
      const response = await app.request("/api/projects");
      assert.equal(response.status, 401);
      assert.equal(
        ((await response.json()) as { error: { code: string } }).error.code,
        "UNAUTHORIZED",
      );
    } finally {
      state.index.close();
    }
  });

  it("sets the local auth cookie from a tokenized remote UI URL", async () => {
    const { app, state } = await createAuthenticatedApp("0.0.0.0");
    try {
      const unauthenticated = await app.request("/api/status");
      assert.equal(unauthenticated.status, 401);

      const response = await app.request(
        `/?token=${encodeURIComponent(state.storage.localToken)}&view=mobile`,
      );
      assert.equal(response.status, 302);
      assert.equal(response.headers.get("location"), "/?view=mobile");
      const cookie = response.headers.get("set-cookie") ?? "";
      assert.match(cookie, /^nerve_token=/);
      assert.match(cookie, /HttpOnly/);

      assert.doesNotMatch(cookie, /; Secure/);

      const secureResponse = await app.request(
        `https://mobile.test/?token=${encodeURIComponent(state.storage.localToken)}`,
      );
      assert.equal(secureResponse.status, 302);
      assert.match(secureResponse.headers.get("set-cookie") ?? "", /; Secure/);

      const authenticated = await app.request("/api/status", {
        headers: { cookie: cookie.split(";", 1)[0] ?? "" },
      });
      assert.equal(authenticated.status, 200);
    } finally {
      state.index.close();
    }
  });

  it("serves mobile HTTPS setup and CA routes only when enabled", async () => {
    const { app, state } = await createAuthenticatedApp("0.0.0.0");
    try {
      const disabledCert = await app.request("/nerve-local-ca.pem");
      assert.equal(disabledCert.status, 404);

      state.mobileHttps = {
        port: 3748,
        url: "https://192.168.1.5:3748",
        caCertUrl: "http://192.168.1.5:3747/nerve-local-ca.pem",
        caCertPem:
          "-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----\n",
        hosts: ["192.168.1.5", "localhost", "127.0.0.1"],
      };

      const invalidSetup = await app.request("/mobile-setup?token=wrong");
      assert.equal(invalidSetup.status, 401);

      const cert = await app.request("/nerve-local-ca.pem");
      assert.equal(cert.status, 200);
      assert.match(await cert.text(), /BEGIN CERTIFICATE/);

      const setup = await app.request(
        `/mobile-setup?token=${encodeURIComponent(state.storage.localToken)}`,
      );
      assert.equal(setup.status, 200);
      const html = await setup.text();
      assert.match(html, /Nerve mobile HTTPS setup/);
      assert.match(html, /https:\/\/192\.168\.1\.5:3748\/\?token=/);
      assert.match(html, /nerve-local-ca\.pem/);
    } finally {
      state.index.close();
    }
  });
});
