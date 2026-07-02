#!/usr/bin/env node
import { ManagerState } from "./app/manager-state.js";
import { createManagerServer } from "./app/server.js";
import { loadManagerConfig } from "./config/manager-config.js";

async function main(): Promise<void> {
  const config = loadManagerConfig();
  const state = new ManagerState(config);
  await state.init();
  const server = createManagerServer(state);
  server.listen(config.port, config.host, () =>
    console.log(
      JSON.stringify({
        component: "nerve-sandbox-manager",
        host: config.host,
        port: config.port,
        storageDir: config.storageDir,
      }),
    ),
  );
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
