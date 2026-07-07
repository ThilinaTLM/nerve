import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  LogReadOptions,
  ManagedContainerCreateSpec,
  ManagedContainerRef,
  ManagedContainerStatus,
  RemoveOptions,
  RuntimeDriverCapabilities,
  StopOptions,
} from "@nervekit/shared";
import { AutoContainerDriver } from "../src/drivers/auto-container-driver.js";
import type {
  ContainerRuntimeDriver,
  LogChunk,
} from "../src/drivers/container-runtime-driver.js";

const createSpec: ManagedContainerCreateSpec = {
  sandboxId: "sbx_1",
  instanceId: "inst_1",
  image: "nerve-sandbox-agent:dev",
  env: {},
  labels: { "org.nerve.sandbox.spec": "v1" },
  mounts: [],
};

describe("auto container driver", () => {
  it("reports Docker capabilities when Docker is available", async () => {
    const docker = fakeDriver("docker", true);
    const podman = fakeDriver("podman", true);
    const driver = new AutoContainerDriver([docker, podman]);

    const capabilities = await driver.capabilities();

    assert.equal(capabilities.kind, "docker");
    assert.equal(capabilities.available, true);
    assert.equal(docker.calls.capabilities, 1);
    assert.equal(podman.calls.capabilities, 0);
  });

  it("falls back to Podman when Docker is unavailable", async () => {
    const docker = fakeDriver("docker", false);
    const podman = fakeDriver("podman", true);
    const driver = new AutoContainerDriver([docker, podman]);

    const capabilities = await driver.capabilities();
    const ref = await driver.create(createSpec);

    assert.equal(capabilities.kind, "podman");
    assert.equal(ref.kind, "podman");
    assert.equal(docker.calls.create, 0);
    assert.equal(podman.calls.create, 1);
  });

  it("routes existing refs to their concrete runtime", async () => {
    const docker = fakeDriver("docker", true);
    const podman = fakeDriver("podman", true);
    const driver = new AutoContainerDriver([docker, podman]);

    await driver.start({ kind: "podman", id: "p1" });
    await driver.stop({ kind: "docker", id: "d1" });
    await driver.remove({ kind: "podman", id: "p2" });

    assert.equal(docker.calls.stop, 1);
    assert.equal(docker.calls.start, 0);
    assert.equal(podman.calls.start, 1);
    assert.equal(podman.calls.remove, 1);
  });

  it("returns unavailable auto capabilities and rejects create when no runtime is available", async () => {
    const driver = new AutoContainerDriver([
      fakeDriver("docker", false),
      fakeDriver("podman", false),
    ]);

    const capabilities = await driver.capabilities();

    assert.equal(capabilities.kind, "auto");
    assert.equal(capabilities.available, false);
    assert.match(capabilities.limitations.join(" "), /docker/);
    assert.match(capabilities.limitations.join(" "), /podman/);
    await assert.rejects(
      () => driver.create(createSpec),
      /No local container runtime is available/,
    );
  });
});

function fakeDriver(
  kind: "docker" | "podman",
  available: boolean,
): ContainerRuntimeDriver & { calls: Record<string, number> } {
  const calls: Record<string, number> = {
    capabilities: 0,
    create: 0,
    start: 0,
    inspect: 0,
    logs: 0,
    stop: 0,
    kill: 0,
    remove: 0,
  };
  const capabilities = (): RuntimeDriverCapabilities => ({
    kind,
    available,
    version: available ? `${kind}-version` : undefined,
    rootless: kind === "podman" ? true : undefined,
    supportsReadOnlyRootFilesystem: available,
    supportsNoNewPrivileges: available,
    supportsPidsLimit: available,
    supportsCpuLimit: available,
    supportsMemoryLimit: available,
    supportsTmpfs: available,
    limitations: available ? [] : [`${kind} unavailable`],
  });
  return {
    kind,
    calls,
    capabilities: async () => {
      calls.capabilities += 1;
      return capabilities();
    },
    create: async () => {
      calls.create += 1;
      return { kind, id: `${kind}-created` };
    },
    start: async () => {
      calls.start += 1;
    },
    inspect: async (
      ref: ManagedContainerRef,
    ): Promise<ManagedContainerStatus> => {
      calls.inspect += 1;
      return { ref, state: "running" };
    },
    logs: (_ref: ManagedContainerRef, _options?: LogReadOptions) => ({
      async *[Symbol.asyncIterator](): AsyncIterator<LogChunk> {
        calls.logs += 1;
        yield { stream: "stdout", chunk: "log" };
      },
    }),
    stop: async (_ref: ManagedContainerRef, _options?: StopOptions) => {
      calls.stop += 1;
    },
    kill: async () => {
      calls.kill += 1;
    },
    remove: async (_ref: ManagedContainerRef, _options?: RemoveOptions) => {
      calls.remove += 1;
    },
  };
}
