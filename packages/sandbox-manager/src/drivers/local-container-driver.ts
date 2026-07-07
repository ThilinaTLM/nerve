import type { LocalContainerBackend } from "../config/manager-config.js";
import { AutoContainerDriver } from "./auto-container-driver.js";
import type { ContainerRuntimeDriver } from "./container-runtime-driver.js";
import { DockerDriver } from "./docker-driver.js";
import { PodmanDriver } from "./podman-driver.js";

export function createLocalContainerDriver(
  backend: LocalContainerBackend,
): ContainerRuntimeDriver {
  if (backend === "docker") return new DockerDriver();
  if (backend === "podman") return new PodmanDriver();
  return new AutoContainerDriver();
}
