import type { ManagerConfig } from "../config/manager-config.js";
import { ContainerDriverRegistry } from "./container-driver-registry.js";
import type { ContainerRuntimeDriver } from "./container-runtime-driver.js";

export function createContainerDriver(
  config: ManagerConfig,
): ContainerRuntimeDriver {
  return new ContainerDriverRegistry(config);
}
