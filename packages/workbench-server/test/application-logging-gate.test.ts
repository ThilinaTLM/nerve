import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  ApplicationLogQueryResponse,
  StatusResponse,
} from "@nervekit/contracts";
import { createAuthenticatedApp } from "./helpers/server-routes.js";

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
    assert.ok(logs.logs.length >= 1);
  });
});
