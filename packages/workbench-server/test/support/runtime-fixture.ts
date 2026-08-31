import {
  composeServerRuntime,
  type ServerRuntime,
  type ServerRuntimeOptions,
} from "../../src/app/runtime/server-runtime.js";
import type { RuntimeServices } from "../../src/app/bootstrap/create-runtime-services.js";
import type { RuntimeLifecycle } from "../../src/app/runtime/runtime-lifecycle.js";
import type { InitializedStorage } from "../../src/infrastructure/storage-bootstrap/index.js";

export interface RuntimeFixture {
  runtime: ServerRuntime;
  lifecycle: RuntimeLifecycle;
  services: RuntimeServices;
}

export function createRuntimeFixture(
  storage: InitializedStorage,
  host = "127.0.0.1",
  port = 0,
  options: ServerRuntimeOptions = {},
): RuntimeFixture {
  return composeServerRuntime(storage, host, port, options);
}
