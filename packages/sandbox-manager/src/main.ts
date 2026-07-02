#!/usr/bin/env node
import { ManagerState } from "./app/manager-state.js";
import { createManagerServer } from "./app/server.js";
import { loadManagerConfig } from "./config/manager-config.js";
import { discoverOrphanContainers } from "./drivers/orphan-discovery.js";
import { SandboxGarbageCollector } from "./lifecycle/garbage-collector.js";
import { OrphanReconciler } from "./lifecycle/orphan-reconciler.js";
import { SandboxReconciler } from "./lifecycle/reconciler.js";

async function main(): Promise<void> {
  const config = loadManagerConfig();
  const state = new ManagerState(config);
  await state.init();
  const lifecycle = createLifecycle(state);
  if (config.reconcileOnStartup) await lifecycle.runOnce();
  const timers = lifecycle.startTimers();
  const server = createManagerServer(state);
  server.on("close", () => {
    for (const timer of timers) clearInterval(timer);
  });
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

  function createLifecycle(state: ManagerState): {
    runOnce: () => Promise<void>;
    startTimers: () => NodeJS.Timeout[];
  } {
    const reconciler = new SandboxReconciler(state.sandboxes, state.driver);
    const gc = new SandboxGarbageCollector(state.sandboxes);
    const orphans = new OrphanReconciler(state.sandboxes, state.driver);
    const runOnce = async () => {
      await reconciler.reconcile();
      const refs = await discoverOrphanContainers(state.config.backend);
      await orphans.reconcile(refs, mapOrphanPolicy(state.config.orphanPolicy));
      await gc.collect();
    };
    return {
      runOnce,
      startTimers: () => {
        const timers: NodeJS.Timeout[] = [];
        if (state.config.reconcileIntervalMs) {
          const timer = setInterval(
            () => void reconciler.reconcile(),
            state.config.reconcileIntervalMs,
          );
          timer.unref();
          timers.push(timer);
        }
        if (state.config.gcIntervalMs) {
          const timer = setInterval(
            () => void gc.collect(),
            state.config.gcIntervalMs,
          );
          timer.unref();
          timers.push(timer);
        }
        return timers;
      },
    };
  }

  function mapOrphanPolicy(
    policy: ManagerState["config"]["orphanPolicy"],
  ): "adopt" | "stop" | "remove" | "ignore" {
    if (policy === "stop_remove") return "remove";
    if (policy === "recover") return "adopt";
    return policy;
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
