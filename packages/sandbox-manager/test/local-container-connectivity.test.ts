import type {
  RuntimeDriverCapabilities,
  SandboxContainerBackend,
} from "@nervekit/contracts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  managerCallbackBaseUrl,
  resolveEffectiveSandboxBackend,
  sandboxContainerNetworkMode,
} from "../src/config/local-container-connectivity.js";
import type { ContainerRuntimeDriver } from "../src/drivers/container-runtime-driver.js";

const config = { host: "0.0.0.0", port: 7869 };

describe("local container connectivity", () => {
  it("rejects auto when no concrete runtime is available", async () => {
    await assert.rejects(
      () =>
        resolveEffectiveSandboxBackend(
          driverCapabilities("auto", false, ["no runtime available"]),
          "auto",
        ),
      /no runtime available/,
    );
  });

  it("uses host networking only for Windows Podman", () => {
    assert.equal(sandboxContainerNetworkMode("podman", "win32"), "host");
    assert.equal(sandboxContainerNetworkMode("podman-wsl", "win32"), "host");
    assert.equal(sandboxContainerNetworkMode("docker", "win32"), "bridge");
    assert.equal(sandboxContainerNetworkMode("podman", "linux"), "bridge");
  });

  it("honors an explicit public URL and selects the requested protocol", () => {
    const env = {
      NERVE_SANDBOX_MANAGER_PUBLIC_URL: "https://manager.example/base/",
    };
    assert.equal(
      managerCallbackBaseUrl(config, "docker", "ws", "linux", env),
      "wss://manager.example/base",
    );
    assert.equal(
      managerCallbackBaseUrl(config, "docker", "http", "linux", env),
      "https://manager.example/base",
    );
  });
});

function driverCapabilities(
  kind: SandboxContainerBackend,
  available = true,
  limitations: string[] = [],
): ContainerRuntimeDriver {
  return {
    kind,
    capabilities: () => runtimeCapabilities(kind, available, limitations),
  } as unknown as ContainerRuntimeDriver;
}

function runtimeCapabilities(
  kind: SandboxContainerBackend,
  available = true,
  limitations: string[] = [],
): RuntimeDriverCapabilities {
  return {
    kind,
    available,
    supportsReadOnlyRootFilesystem: available,
    supportsNoNewPrivileges: available,
    supportsPidsLimit: available,
    supportsCpuLimit: available,
    supportsMemoryLimit: available,
    supportsTmpfs: available,
    supportsLogs: available,
    limitations,
  };
}
