export interface RuntimeShutdownResources {
  gitOperations: { close(): Promise<void> };
  workspaceMonitor: { close(): Promise<void> };
  launches: { shutdown(): Promise<void> };
  fileCompletions: { dispose(): Promise<void> };
  conversationCore: { close(): Promise<void> };
}

/** Each producer fully settles before dependencies close, even when a drain rejects. */
export async function shutdownRuntimeResources(
  resources: RuntimeShutdownResources,
): Promise<void> {
  const failures: unknown[] = [];
  try {
    await resources.gitOperations.close();
  } catch (error) {
    failures.push(error);
  }
  try {
    await resources.workspaceMonitor.close();
  } catch (error) {
    failures.push(error);
  }
  try {
    await resources.launches.shutdown();
  } catch (error) {
    failures.push(error);
  }
  try {
    await resources.fileCompletions.dispose();
  } catch (error) {
    failures.push(error);
  }
  try {
    await resources.conversationCore.close();
  } catch (error) {
    failures.push(error);
  }
  if (failures.length)
    throw new AggregateError(failures, "Runtime resource shutdown failed");
}
