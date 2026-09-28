import { inspectPendingHomeMigrationsCore } from "../migrations/home-migration-plan.js";
import { applyHomeMigrationPlanCore } from "../migrations/current-home-migration.js";
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
// Bootstrap may await test-unreferenced SQLite workers; keep this operation
// alive until all nested storage handles and locks have been closed.
port.ref();

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
  if (request.operation === "inspect-current") {
    const value = await inspectPendingHomeMigrationsCore(request.home);
    send({ type: "success", result: { operation: "inspect-current", value } });
  } else if (request.operation === "apply-current") {
    const value = await applyHomeMigrationPlanCore(
      request.home,
      request.plan,
      request.approval,
      { reportProgress: report },
    );
    send({ type: "success", result: { operation: "apply-current", value } });
  } else if (request.operation === "inspect") {
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
} finally {
  port.close();
}
