import type { StatusResponse } from "@nervekit/contracts";
import { apiGet } from "../daemon/http-client.js";

export async function commandStatus(): Promise<void> {
  const status = await apiGet<StatusResponse>("/api/status");
  console.log(`nerve daemon: ${status.daemonId}`);
  console.log(`version: ${status.version}`);
  console.log(`started: ${status.startedAt}`);
  console.log(`data: ${status.dataDir}`);
  console.log(
    `sqlite: ${status.storage.sqlitePath} (${status.storage.indexHealthy ? "healthy" : "unhealthy"})`,
  );
}
