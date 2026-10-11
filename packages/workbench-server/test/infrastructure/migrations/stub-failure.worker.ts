import { parentPort } from "node:worker_threads";

parentPort?.postMessage({
  type: "progress",
  progress: { step: "0001-x", description: "d", phase: "run" },
});
parentPort?.postMessage({
  type: "error",
  message: "boom\nMigration failure report: /tmp/last-failure.json",
});
