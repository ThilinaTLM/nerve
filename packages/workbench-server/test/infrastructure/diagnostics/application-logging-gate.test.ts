import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  ApplicationLogQueryResponse,
  StatusResponse,
} from "@nervekit/contracts";
import { createAuthenticatedApp } from "../../helpers/server-routes.js";

describe("application logging gate", () => {
  it("reports logging unavailable and does not mount log routes by default", async () => {
    const { app, headers } = await createAuthenticatedApp();

    const configResponse = await app.request("/api/client-config", { headers });
    const config = (await configResponse.json()) as { status: StatusResponse };
    assert.equal(config.status.capabilities.applicationLogs, false);

    const logsResponse = await app.request("/api/logs", { headers });
    assert.equal(logsResponse.status, 404);
  });

  it("reports and mounts application logs after explicit enablement", async () => {
    const { app, headers } = await createAuthenticatedApp("127.0.0.1", {
      applicationLogsEnabled: true,
    });

    const configResponse = await app.request("/api/client-config", { headers });
    const config = (await configResponse.json()) as { status: StatusResponse };
    assert.equal(config.status.capabilities.applicationLogs, true);

    const logsResponse = await app.request("/api/logs", { headers });
    assert.equal(logsResponse.status, 200);
    const logs = (await logsResponse.json()) as ApplicationLogQueryResponse;
    const configLog = logs.logs.find(
      (log) => log.message === "GET /api/client-config completed (200)",
    );
    assert.ok(configLog);
    assert.equal(configLog.component, "http");
    assert.match(configLog.requestId ?? "", /^log_/);
    assert.ok((configLog.durationMs ?? -1) >= 0);
    assert.deepEqual(configLog.context, {
      method: "GET",
      path: "/api/client-config",
      status: 200,
    });
  });

  it("identifies authorization failures by method and path", async () => {
    const { app, state } = await createAuthenticatedApp("127.0.0.1", {
      applicationLogsEnabled: true,
    });

    const response = await app.request("/api/client-config");
    assert.equal(response.status, 401);
    const logs = await state.logger.query({ component: "http", limit: 10 });
    const authorization = logs.logs.find((log) =>
      log.message.includes("authorization failed"),
    );
    assert.equal(
      authorization?.message,
      "GET /api/client-config authorization failed",
    );
    assert.deepEqual(authorization?.context, {
      method: "GET",
      path: "/api/client-config",
      mode: "none",
    });
  });
});
