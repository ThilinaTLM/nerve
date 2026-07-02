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

export class DockerDriver implements ContainerRuntimeDriver {
  readonly kind = "docker";

  async capabilities(): Promise<RuntimeDriverCapabilities> {
    try {
      const { stdout } = await execFileAsync(
        "docker",
        ["version", "--format", "{{.Server.Version}}"],
        {
          timeout: 2_000,
        },
      );
      return {
        kind: this.kind,
        available: true,
        version: stdout.trim() || undefined,
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
        "docker CLI is not available",
      );
    }
  }

  async create(spec: ManagedContainerCreateSpec): Promise<ManagedContainerRef> {
    assertValidManagedContainerCreateSpec(spec, { production: true });
    throw new Error("DockerDriver.create is scaffolded but not implemented");
  }

  async start(_ref: ManagedContainerRef): Promise<void> {
    throw new Error("DockerDriver.start is scaffolded but not implemented");
  }

  async inspect(ref: ManagedContainerRef): Promise<ManagedContainerStatus> {
    return { ref, state: "unknown", limitations: ["inspect is scaffolded"] };
  }

  logs(_ref: ManagedContainerRef): AsyncIterable<LogChunk> {
    return emptyLogIterable();
  }

  async stop(_ref: ManagedContainerRef): Promise<void> {
    throw new Error("DockerDriver.stop is scaffolded but not implemented");
  }

  async kill(_ref: ManagedContainerRef): Promise<void> {
    throw new Error("DockerDriver.kill is scaffolded but not implemented");
  }

  async remove(_ref: ManagedContainerRef): Promise<void> {
    throw new Error("DockerDriver.remove is scaffolded but not implemented");
  }
}
