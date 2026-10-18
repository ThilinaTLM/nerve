export interface ServerShutdownResources {
  maintenance: { shutdown(): Promise<void> };
  lifecycle: { shutdown(): Promise<void> };
  activities: { dispose(): void | Promise<void> };
  agentBrowserSkills: { shutdown(): Promise<void> };
  subscriptionUsage: { stop(): void | Promise<void> };
  logger: { flush(): Promise<void> };
}

const shutdownOperations = new WeakMap<
  ServerShutdownResources,
  Promise<void>
>();

/** HTTP/WebSocket sessions must already be closed. Await all producer drains before Activity finalization. */
export function shutdownServerRuntime(
  state: ServerShutdownResources,
): Promise<void> {
  const existing = shutdownOperations.get(state);
  if (existing) return existing;
  const operation = Promise.resolve().then(async () => {
    const failures: unknown[] = [];
    try {
      await state.maintenance.shutdown();
    } catch (error) {
      failures.push(error);
    }
    try {
      await state.lifecycle.shutdown();
    } catch (error) {
      failures.push(error);
    }
    try {
      await state.activities.dispose();
    } catch (error) {
      failures.push(error);
    }
    try {
      await state.agentBrowserSkills.shutdown();
    } catch (error) {
      failures.push(error);
    }
    try {
      await state.subscriptionUsage.stop();
    } catch (error) {
      failures.push(error);
    }
    try {
      await state.logger.flush();
    } catch (error) {
      failures.push(error);
    }
    if (failures.length)
      throw new AggregateError(failures, "Server runtime shutdown failed");
  });
  shutdownOperations.set(state, operation);
  return operation;
}
