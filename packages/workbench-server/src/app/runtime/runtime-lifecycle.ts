import { shutdownRuntimeResources } from "./shutdown-runtime-resources.js";
import {
  createRuntimeServices,
  type RuntimeDeps,
  type RuntimeServices,
} from "../bootstrap/create-runtime-services.js";

export interface RuntimeHydrationTimings {
  authRefreshMs: number;
  providerLoadMs: number;
  conversationCoreStartMs: number;
  coreStartedLogMs: number;
  totalMs: number;
}

export class RuntimeLifecycle {
  readonly services: RuntimeServices;
  private shutdownOperation?: Promise<void>;

  static compose(deps: RuntimeDeps) {
    const lifecycle = new RuntimeLifecycle(deps);
    return { lifecycle, services: lifecycle.services };
  }

  private constructor(private readonly deps: RuntimeDeps) {
    this.services = createRuntimeServices(deps);
  }

  async hydrate(): Promise<RuntimeHydrationTimings> {
    const startedAt = performance.now();
    await this.deps.auth.refreshModels({ allowNetwork: false });
    const authRefreshedAt = performance.now();
    await this.deps.providerCatalog.load();
    const providerLoadedAt = performance.now();
    await this.services.conversationCore.start();
    const coreStartedAt = performance.now();
    await this.deps.logger.info("Conversation core started");
    const completedAt = performance.now();
    return {
      authRefreshMs: authRefreshedAt - startedAt,
      providerLoadMs: providerLoadedAt - authRefreshedAt,
      conversationCoreStartMs: coreStartedAt - providerLoadedAt,
      coreStartedLogMs: completedAt - coreStartedAt,
      totalMs: completedAt - startedAt,
    };
  }

  shutdown(): Promise<void> {
    return (this.shutdownOperation ??= shutdownRuntimeResources(this.services));
  }
}
