import type {
  LogReadOptions,
  ManagedContainerCreateSpec,
  ManagedContainerRef,
  ManagedContainerStatus,
  RemoveOptions,
  SandboxContainerBackend,
  SandboxManagerBackendOption,
  StopOptions,
} from "@nervekit/contracts";
import type { ManagerConfig } from "../config/manager-config.js";
import { AutoContainerDriver } from "./auto-container-driver.js";
import type {
  ContainerRuntimeDriver,
  LogChunk,
} from "./container-runtime-driver.js";
import { DockerDriver } from "./docker-driver.js";
import { EcsContainerDriver } from "./ecs-driver.js";
import { discoverOrphanContainers } from "./orphan-discovery.js";
import { PodmanDriver } from "./podman-driver.js";
import { PodmanWslDriver } from "./podman-wsl-driver.js";

const BACKEND_LABELS: Record<SandboxContainerBackend, string> = {
  auto: "Auto",
  docker: "Docker",
  podman: "Podman",
  "podman-wsl": "Podman (WSL)",
  ecs: "ECS/Fargate",
};

export class ContainerDriverRegistry implements ContainerRuntimeDriver {
  readonly kind: string;
  private readonly drivers: Map<string, ContainerRuntimeDriver>;

  constructor(private readonly config: ManagerConfig) {
    const docker = new DockerDriver();
    const podman = new PodmanDriver();
    const podmanWsl = new PodmanWslDriver(config);
    this.kind = config.backend;
    this.drivers = new Map<string, ContainerRuntimeDriver>([
      ["docker", docker],
      ["podman", podman],
      ["podman-wsl", podmanWsl],
      ["ecs", new EcsContainerDriver(config)],
      ["auto", new AutoContainerDriver([docker, podman, podmanWsl])],
    ]);
  }

  capabilities() {
    return this.driverForBackend(this.config.backend).capabilities();
  }

  async backendOptions(): Promise<SandboxManagerBackendOption[]> {
    const options: SandboxManagerBackendOption[] = [];
    for (const backend of [
      "auto",
      "docker",
      "podman",
      "podman-wsl",
      "ecs",
    ] satisfies SandboxContainerBackend[]) {
      const runtime = await this.driverForBackend(backend).capabilities();
      options.push({
        kind: backend,
        label: BACKEND_LABELS[backend],
        available: runtime.available,
        default: backend === this.config.backend,
        runtime,
      });
    }
    return options;
  }

  async create(spec: ManagedContainerCreateSpec): Promise<ManagedContainerRef> {
    return this.driverForBackend(spec.backend).create(spec);
  }

  async start(ref: ManagedContainerRef): Promise<void> {
    await this.driverForRef(ref).start(ref);
  }

  async inspect(ref: ManagedContainerRef): Promise<ManagedContainerStatus> {
    return this.driverForRef(ref).inspect(ref);
  }

  logs(
    ref: ManagedContainerRef,
    options: LogReadOptions = {},
  ): AsyncIterable<LogChunk> {
    return this.driverForRef(ref).logs(ref, options);
  }

  async stop(
    ref: ManagedContainerRef,
    options: StopOptions = {},
  ): Promise<void> {
    await this.driverForRef(ref).stop(ref, options);
  }

  async kill(ref: ManagedContainerRef, signal?: string): Promise<void> {
    await this.driverForRef(ref).kill(ref, signal);
  }

  async remove(
    ref: ManagedContainerRef,
    options: RemoveOptions = {},
  ): Promise<void> {
    await this.driverForRef(ref).remove(ref, options);
  }

  async listManaged(): Promise<ManagedContainerRef[]> {
    const local = await discoverOrphanContainers("auto");
    const ecs =
      (await this.drivers
        .get("ecs")
        ?.listManaged?.()
        .catch(() => [])) ?? [];
    return [...local, ...ecs];
  }

  private driverForRef(ref: ManagedContainerRef): ContainerRuntimeDriver {
    return (
      this.drivers.get(ref.kind) ?? this.driverForBackend(this.config.backend)
    );
  }

  private driverForBackend(backend: string): ContainerRuntimeDriver {
    const driver = this.drivers.get(backend) ?? this.drivers.get("auto");
    if (!driver) throw new Error("Auto container driver is not registered");
    return driver;
  }
}
