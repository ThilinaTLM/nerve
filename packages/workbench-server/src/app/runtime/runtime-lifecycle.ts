import {
  createRuntimeServices,
  type RuntimeDeps,
  type RuntimeServices,
} from "../bootstrap/create-runtime-services.js";

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

  async hydrate(): Promise<void> {
    await this.deps.auth.refreshModels({ allowNetwork: false });
    await this.deps.providerCatalog.load();
    await this.services.conversationCore.start();
    await this.deps.logger.info("Conversation core started");
  }

  shutdown(): Promise<void> {
    return (this.shutdownOperation ??= (async () => {
      await this.services.workspaceMonitor.close();
      await this.services.launches.shutdown();
      await this.services.conversationCore.close();
    })());
  }
}
