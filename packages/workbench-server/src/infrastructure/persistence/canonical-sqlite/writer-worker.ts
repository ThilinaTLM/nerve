import { parentPort, workerData } from "node:worker_threads";
import { CanonicalDatabase } from "./canonical-database.js";
import { executeCanonicalCommand } from "./worker-handler.js";
import type {
  CanonicalWorkerRequest,
  CanonicalWorkerResponse,
} from "./worker-protocol.js";

if (!parentPort) throw new Error("Canonical writer requires a parent port.");
const port = parentPort;
const database = new CanonicalDatabase((workerData as { path: string }).path);

port.on("message", (request: CanonicalWorkerRequest) => {
  let response: CanonicalWorkerResponse;
  try {
    response = {
      id: request.id,
      ok: true,
      value: executeCanonicalCommand(database, request.command),
    };
  } catch (error) {
    const cause = error instanceof Error ? error : new Error(String(error));
    response = {
      id: request.id,
      ok: false,
      error: { name: cause.name, message: cause.message, stack: cause.stack },
    };
  }
  port.postMessage(response);
});
