import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  ManagedContainerCreateSpec,
  ManagedContainerRef,
  ManagedContainerStatus,
  RuntimeDriverCapabilities,
} from "@nervekit/shared";
import {
  type ContainerRuntimeDriver,
  type LogChunk,
  unavailableRuntimeCapabilities,
} from "./container-runtime-driver.js";
import { assertValidManagedContainerCreateSpec } from "./validation.js";

const execFileAsync = promisify(execFile);

function emptyLogIterable(): AsyncIterable<LogChunk> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<LogChunk> {
      return {
        async next(): Promise<IteratorResult<LogChunk>> {
          return { done: true, value: undefined };
        },
      };
    },
  };
}

export class PodmanDriver implements ContainerRuntimeDriver {
  readonly kind = "podman";

  async capabilities(): Promise<RuntimeDriverCapabilities> {
    try {
      const { stdout } = await execFileAsync(
        "podman",
        ["version", "--format", "{{.Version}}"],
        {
          timeout: 2_000,
        },
      );
      return {
        kind: this.kind,
        available: true,
        version: stdout.trim() || undefined,
        rootless: true,
        supportsReadOnlyRootFilesystem: true,
        supportsNoNewPrivileges: true,
        supportsPidsLimit: true,
        supportsCpuLimit: true,
        supportsMemoryLimit: true,
        supportsTmpfs: true,
        limitations: [
          "create/start operations are scaffolded and not yet wired",
        ],
      };
    } catch {
      return unavailableRuntimeCapabilities(
        this.kind,
        "podman CLI is not available",
      );
    }
  }

  async create(spec: ManagedContainerCreateSpec): Promise<ManagedContainerRef> {
    assertValidManagedContainerCreateSpec(spec, { production: true });
    throw new Error("PodmanDriver.create is scaffolded but not implemented");
  }

  async start(_ref: ManagedContainerRef): Promise<void> {
    throw new Error("PodmanDriver.start is scaffolded but not implemented");
  }

  async inspect(ref: ManagedContainerRef): Promise<ManagedContainerStatus> {
    return { ref, state: "unknown", limitations: ["inspect is scaffolded"] };
  }

  logs(_ref: ManagedContainerRef): AsyncIterable<LogChunk> {
    return emptyLogIterable();
  }

  async stop(_ref: ManagedContainerRef): Promise<void> {
    throw new Error("PodmanDriver.stop is scaffolded but not implemented");
  }

  async kill(_ref: ManagedContainerRef): Promise<void> {
    throw new Error("PodmanDriver.kill is scaffolded but not implemented");
  }

  async remove(_ref: ManagedContainerRef): Promise<void> {
    throw new Error("PodmanDriver.remove is scaffolded but not implemented");
  }
}
