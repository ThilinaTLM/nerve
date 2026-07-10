import type { LogReadOptions, ManagedContainerRef } from "@nervekit/contracts";
import type {
  ContainerRuntimeDriver,
  LogChunk,
} from "../drivers/container-runtime-driver.js";

export class LogCollector {
  constructor(private readonly driver: ContainerRuntimeDriver) {}

  logs(
    ref: ManagedContainerRef,
    options: LogReadOptions = {},
  ): AsyncIterable<LogChunk> {
    return this.driver.logs(ref, {
      tail: options.tail ?? 500,
      since: options.since,
    });
  }
}
