import { parentPort, workerData } from "node:worker_threads";
import {
  applyStorageMigrationPlanCore,
  inspectStorageMigrationPlanCore,
} from "./core.js";
import type {
  StorageMigrationWorkerRequest,
  StorageMigrationWorkerResponse,
} from "./worker-protocol.js";

const port = parentPort;
if (!port) throw new Error("Storage migration worker requires a parent port.");

const request = workerData as StorageMigrationWorkerRequest;
const send = (response: StorageMigrationWorkerResponse): void => {
  port.postMessage(response);
};

try {
  const report = (
    progress: Extract<
      StorageMigrationWorkerResponse,
      { type: "progress" }
    >["progress"],
  ) => send({ type: "progress", progress });
  if (request.operation === "inspect") {
    const value = await inspectStorageMigrationPlanCore(request.home, report);
    send({ type: "success", result: { operation: "inspect", value } });
  } else {
    const value = await applyStorageMigrationPlanCore(
      request.home,
      request.plan,
      request.approval,
      report,
    );
    send({ type: "success", result: { operation: "apply", value } });
  }
} catch (error) {
  const value = error instanceof Error ? error : new Error(String(error));
  const details = value as Error & {
    code?: unknown;
    quarantineIds?: unknown;
  };
  send({
    type: "failure",
    error: {
      name: value.name,
      message: value.message,
      ...(value.stack ? { stack: value.stack } : {}),
      ...(typeof details.code === "string" ? { code: details.code } : {}),
      ...(Array.isArray(details.quarantineIds) &&
      details.quarantineIds.every((id) => typeof id === "string")
        ? { quarantineIds: details.quarantineIds }
        : {}),
    },
  });
}
