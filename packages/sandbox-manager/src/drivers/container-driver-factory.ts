import type { ManagerConfig } from "../config/manager-config.js";
import type { ContainerRuntimeDriver } from "./container-runtime-driver.js";
import { EcsContainerDriver } from "./ecs-driver.js";
import { createLocalContainerDriver } from "./local-container-driver.js";

export function createContainerDriver(
  config: ManagerConfig,
): ContainerRuntimeDriver {
  if (config.backend === "ecs") return new EcsContainerDriver(config);
  return createLocalContainerDriver(config.backend);
}
