import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  RuntimeDriverCapabilities,
  SandboxContainerBackend,
} from "@nervekit/contracts";
import {
  managerCallbackBaseUrl,
  resolveEffectiveSandboxBackend,
  sandboxContainerNetworkMode,
} from "../src/config/local-container-connectivity.js";
import type { ContainerRuntimeDriver } from "../src/drivers/container-runtime-driver.js";

const config = { host: "0.0.0.0", port: 7869 };

describe("local container connectivity", () => {
  it("resolves auto to the concrete available runtime", async () => {
    assert.equal(
      await resolveEffectiveSandboxBackend(
        driverCapabilities("podman-wsl"),
        "auto",
      ),
      "podman-wsl",
    );
  });

  it("resolves an explicit auto override independently of the manager default", async () => {
    const driver = {
      kind: "docker",
      capabilities: () => runtimeCapabilities("docker"),
      backendOptions: async () => [
        {
          kind: "auto",
          label: "Auto",
          available: true,
          runtime: runtimeCapabilities("podman"),
        },
      ],
    } as unknown as ContainerRuntimeDriver;

    assert.equal(
      await resolveEffectiveSandboxBackend(driver, "auto"),
      "podman",
    );
  });

  it("preserves an explicitly requested backend without probing", async () => {
    const driver = {
      capabilities: () => {
        throw new Error("capabilities should not be called");
      },
    } as unknown as ContainerRuntimeDriver;

    assert.equal(
      await resolveEffectiveSandboxBackend(driver, "docker"),
      "docker",
    );
  });

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

  it("selects callback hosts for each local runtime and platform", () => {
    assert.equal(
      managerCallbackBaseUrl(config, "podman", "ws", "win32", {}),
      "ws://127.0.0.1:7869",
    );
    assert.equal(
      managerCallbackBaseUrl(config, "docker", "http", "win32", {}),
      "http://host.docker.internal:7869",
    );
    assert.equal(
      managerCallbackBaseUrl(config, "docker", "http", "linux", {}),
      "http://172.17.0.1:7869",
    );
    assert.equal(
      managerCallbackBaseUrl(config, "podman", "http", "linux", {}),
      "http://host.containers.internal:7869",
    );
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
