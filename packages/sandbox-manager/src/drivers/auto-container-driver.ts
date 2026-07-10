import type {
  LogReadOptions,
  ManagedContainerCreateSpec,
  ManagedContainerRef,
  ManagedContainerStatus,
  RemoveOptions,
  RuntimeDriverCapabilities,
  StopOptions,
} from "@nervekit/contracts";
import {
  type ContainerRuntimeDriver,
  type LogChunk,
  unavailableRuntimeCapabilities,
} from "./container-runtime-driver.js";
import { DockerDriver } from "./docker-driver.js";
import { PodmanDriver } from "./podman-driver.js";
import { PodmanWslDriver } from "./podman-wsl-driver.js";

const LOCAL_DRIVER_KINDS = new Set(["docker", "podman", "podman-wsl"]);

export class AutoContainerDriver implements ContainerRuntimeDriver {
  readonly kind = "auto";
  private selected?: ContainerRuntimeDriver;

  constructor(
    private readonly drivers: ContainerRuntimeDriver[] = [
      new DockerDriver(),
      new PodmanDriver(),
      new PodmanWslDriver(),
    ],
  ) {}

  async capabilities(): Promise<RuntimeDriverCapabilities> {
    const unavailable: RuntimeDriverCapabilities[] = [];
    for (const driver of this.drivers) {
      const capabilities = await driver.capabilities();
      if (capabilities.available) {
        this.selected = driver;
        return capabilities;
      }
      unavailable.push(capabilities);
    }
    return unavailableRuntimeCapabilities(
      this.kind,
      unavailable.length > 0
        ? unavailable
            .map((capabilities) =>
              [capabilities.kind, ...capabilities.limitations].join(": "),
            )
            .join("; ")
        : "No local container drivers are configured",
    );
  }

  async create(spec: ManagedContainerCreateSpec): Promise<ManagedContainerRef> {
    return (await this.resolveActiveDriver()).create(spec);
  }

  async start(ref: ManagedContainerRef): Promise<void> {
    await (await this.driverFor(ref)).start(ref);
  }

  async inspect(ref: ManagedContainerRef): Promise<ManagedContainerStatus> {
    return (await this.driverFor(ref)).inspect(ref);
  }

  logs(
    ref: ManagedContainerRef,
    options: LogReadOptions = {},
  ): AsyncIterable<LogChunk> {
    return {
      [Symbol.asyncIterator]: async function* (
        this: AutoContainerDriver,
      ): AsyncIterator<LogChunk> {
        const driver = await this.driverFor(ref);
        yield* driver.logs(ref, options);
      }.bind(this),
    };
  }

  async stop(
    ref: ManagedContainerRef,
    options: StopOptions = {},
  ): Promise<void> {
    await (await this.driverFor(ref)).stop(ref, options);
  }

  async kill(ref: ManagedContainerRef, signal?: string): Promise<void> {
    await (await this.driverFor(ref)).kill(ref, signal);
  }

  async remove(
    ref: ManagedContainerRef,
    options: RemoveOptions = {},
  ): Promise<void> {
    await (await this.driverFor(ref)).remove(ref, options);
  }

  private async driverFor(
    ref: ManagedContainerRef,
  ): Promise<ContainerRuntimeDriver> {
    if (LOCAL_DRIVER_KINDS.has(ref.kind)) {
      const driver = this.drivers.find(
        (candidate) => candidate.kind === ref.kind,
      );
      if (driver) return driver;
    }
    return this.resolveActiveDriver();
  }

  private async resolveActiveDriver(): Promise<ContainerRuntimeDriver> {
    if (this.selected) {
      const capabilities = await this.selected.capabilities();
      if (capabilities.available) return this.selected;
      this.selected = undefined;
    }
    const unavailable: RuntimeDriverCapabilities[] = [];
    for (const driver of this.drivers) {
      const capabilities = await driver.capabilities();
      if (capabilities.available) {
        this.selected = driver;
        return driver;
      }
      unavailable.push(capabilities);
    }
    const details = unavailable
      .map((capabilities) =>
        [capabilities.kind, ...capabilities.limitations].join(": "),
      )
      .join("; ");
    throw new Error(
      `No local container runtime is available${details ? ` (${details})` : ""}`,
    );
  }
}
