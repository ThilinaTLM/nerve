import type { ManagedContainerRef } from "@nervekit/shared";
import type {
  ContainerRuntimeDriver,
  LogChunk,
} from "../drivers/container-runtime-driver.js";

export class LogCollector {
  constructor(private readonly driver: ContainerRuntimeDriver) {}

  logs(ref: ManagedContainerRef): AsyncIterable<LogChunk> {
    return this.driver.logs(ref, { tail: 500 });
  }
}
