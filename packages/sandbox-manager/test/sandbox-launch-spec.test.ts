import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SandboxConfigV1 } from "@nervekit/contracts";
import { buildSandboxLaunchSpec } from "../src/config/sandbox-launch-spec.js";

function baseConfig(
  observability?: SandboxConfigV1["observability"],
): SandboxConfigV1 {
  return {
    version: 1,
    agent: {
      defaultModel: { provider: "openai-codex", model: "gpt-5.4-mini" },
      defaultMode: "normal",
    },
    controller: {
      auth: { type: "api_key", apiKey: "x" },
      websocket: { url: "ws://127.0.0.1:7869/api/sandboxes/sbx_1/ws" },
    },
    observability,
  } as unknown as SandboxConfigV1;
}

const options = {
  image: "nerve-sandbox-agent:dev",
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
    assert.equal(spec.env?.NERVE_SANDBOX_AGENT_LOG_LEVEL, "debug");
  });

  it("does not override an explicit sandbox observability.logLevel", () => {
    const spec = buildSandboxLaunchSpec(baseConfig({ logLevel: "warn" }), {
      ...options,
      logLevel: "debug",
    });
    assert.equal(spec.env?.NERVE_SANDBOX_AGENT_LOG_LEVEL, undefined);
  });

  it("omits the env var when the manager provides no level", () => {
    const spec = buildSandboxLaunchSpec(baseConfig(), options);
    assert.equal(spec.env?.NERVE_SANDBOX_AGENT_LOG_LEVEL, undefined);
  });

  it("uses manager launch labels and resources outside sandbox YAML", () => {
    const spec = buildSandboxLaunchSpec(baseConfig(), {
      ...options,
      backend: "docker",
      labels: { team: "core" },
      resources: { memoryMb: 8192, vcpu: 2 },
    });
    assert.equal(spec.backend, "docker");
    assert.equal(spec.labels.team, "core");
    assert.equal(spec.labels["org.nerve.sandbox.id"], "sbx_1");
    assert.deepEqual(spec.resources, { memoryMb: 8192, vcpu: 2 });
  });

  it("propagates instance id and builds ECS/EFS mounts", () => {
    const spec = buildSandboxLaunchSpec(baseConfig(), {
      image: "123456789012.dkr.ecr.us-east-1.amazonaws.com/agent:dev",
      sandboxId: "sbx_1",
      managerBaseUrl: "http://manager.internal:7869",
      backend: "ecs",
      runtimeMounts: {
        workspace: {
          kind: "efs",
          name: "/nerve/sbx_1/workspace",
          source: "/mnt/efs/sbx_1/workspace",
          target: "/workspace",
        },
        state: {
          kind: "efs",
          name: "/nerve/sbx_1/state",
          source: "/mnt/efs/sbx_1/state",
          target: "/state",
        },
        config: {
          kind: "efs",
          name: "/nerve/sbx_1/config",
          source: "/mnt/efs/sbx_1/config/sandbox.yaml",
          target: "/etc/nerve",
          readonly: true,
        },
        secrets: {
          kind: "efs",
          name: "/nerve/sbx_1/secrets",
          source: "/mnt/efs/sbx_1/secrets",
          target: "/secrets",
          readonly: true,
        },
        tmp: {
          kind: "efs",
          name: "/nerve/sbx_1/tmp",
          source: "/mnt/efs/sbx_1/tmp",
          target: "/tmp",
        },
      },
    });
    assert.equal(spec.network?.mode, "ecs-awsvpc");
    assert.equal(spec.env.NERVE_SANDBOX_AGENT_SANDBOX_ID, "sbx_1");
    assert.equal(spec.env.NERVE_SANDBOX_AGENT_INSTANCE_ID, spec.instanceId);
    assert.equal(
      spec.mounts.find((mount) => mount.target === "/etc/nerve")?.kind,
      "efs",
    );
    assert.equal(
      spec.mounts.find((mount) => mount.target === "/tmp")?.kind,
      "efs",
    );
    assert.equal(
      spec.mounts.some((mount) => mount.kind === "tmpfs"),
      false,
    );
  });
});
