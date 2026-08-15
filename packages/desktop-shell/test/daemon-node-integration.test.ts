import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkHealth } from "../src/daemon/node-integration.ts";

describe("daemon Node health integration", () => {
  it("uses the authenticated minimal health endpoint", async () => {
    let requestedUrl = "";
    let authorization = "";
    const result = await checkHealth("http://127.0.0.1:3747", "tok_test", {
      now: (() => {
        let current = 10;
        return () => current++;
      })(),
      fetch: async (input, init) => {
        requestedUrl = String(input);
        authorization = String(
          (init?.headers as Record<string, string>)?.authorization,
        );
        return new Response(null, { status: 200 });
      },
    });

    assert.equal(requestedUrl, "http://127.0.0.1:3747/api/health");
    assert.equal(authorization, "Bearer tok_test");
    assert.deepEqual(result, {
      healthy: true,
      outcome: "ok",
      durationMs: 1,
      status: 200,
    });
  });

  it("classifies HTTP, network, and timeout failures", async () => {
    const http = await checkHealth("http://127.0.0.1:3747", "tok_test", {
      fetch: async () => new Response(null, { status: 503 }),
    });
    assert.equal(http.outcome, "http_error");
    assert.equal(http.status, 503);

    const network = await checkHealth("http://127.0.0.1:3747", "tok_test", {
      fetch: async () => {
        throw new Error("connection refused");
      },
    });
    assert.equal(network.outcome, "network_error");
    assert.equal(network.error, "connection refused");

    const timedOut = await checkHealth("http://127.0.0.1:3747", "tok_test", {
      timeoutMs: 1,
      fetch: async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
        }),
    });
    assert.equal(timedOut.outcome, "timeout");
    assert.equal(timedOut.error, "aborted");
  });
});
