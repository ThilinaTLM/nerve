import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SandboxConfigV1 } from "@nervekit/shared";
import { buildSandboxLaunchSpec } from "../src/config/sandbox-launch-spec.js";

function baseConfig(
  observability?: SandboxConfigV1["observability"],
): SandboxConfigV1 {
  return {
    version: 1,
    identity: { sandboxId: "sbx_1" },
    agent: {
      mainModel: { provider: "openai-codex", model: "gpt-5.4-mini" },
      mode: "normal",
    },
    controller: {
      auth: { type: "api_key", apiKey: "x" },
      websocket: { url: "ws://127.0.0.1:7869/api/sandboxes/sbx_1/ws" },
    },
    observability,
  } as unknown as SandboxConfigV1;
}

const options = {
  image: "nerve-sandbox:dev",
  sandboxId: "sbx_1",
  managerBaseUrl: "http://127.0.0.1:7869",
  workspaceSource: "/w",
  stateSource: "/s",
  configSource: "/c/sandbox.yaml",
  secretsSource: "/sec",
};

describe("buildSandboxLaunchSpec log level propagation", () => {
  it("propagates the manager log level to the container env", () => {
    const spec = buildSandboxLaunchSpec(baseConfig(), {
      ...options,
      logLevel: "debug",
    });
    assert.equal(spec.env?.NERVE_SANDBOX_LOG_LEVEL, "debug");
  });

  it("does not override an explicit sandbox observability.logLevel", () => {
    const spec = buildSandboxLaunchSpec(baseConfig({ logLevel: "warn" }), {
      ...options,
      logLevel: "debug",
    });
    assert.equal(spec.env?.NERVE_SANDBOX_LOG_LEVEL, undefined);
  });

  it("omits the env var when the manager provides no level", () => {
    const spec = buildSandboxLaunchSpec(baseConfig(), options);
    assert.equal(spec.env?.NERVE_SANDBOX_LOG_LEVEL, undefined);
  });
});
