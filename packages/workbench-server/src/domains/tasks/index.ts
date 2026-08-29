export { TaskRepository } from "./persistence/task.repository.js";
export type { TaskLaunchConfigStore } from "./persistence/task-launch-config.store.js";
export {
  SecretTaskLaunchConfigStore,
  taskLaunchConfigSecretName,
  UnconfiguredTaskLaunchConfigStore,
} from "./persistence/task-launch-config.store.js";
export type {
  TaskLogCursor,
  TaskLogStream,
} from "./application/task-log.service.js";
export {
  createTaskLogCursor,
  MAX_BUFFERED_LOG_LINE_CHARS,
  TaskLogService,
} from "./application/task-log.service.js";
export { TaskNotificationService } from "./application/task-notification.service.js";
export type { TaskPortInspector } from "./adapters/task-port-inspector.js";
export {
  dedupeListeningPorts,
  defaultTaskPortInspector,
  formatListeningPort,
  inspectPortListeners,
  inspectRuntimeListeningPorts,
  isSameProcessIdentity,
} from "./adapters/task-port-inspector.js";
export { isPathInDirectoryTree } from "./model/task-scope.js";
export {
  isActiveTaskStatus,
  isOrphanedTaskStatus,
  isStoppableTaskStatus,
} from "./model/task-status.js";
export type {
  ProcessLifecycleResult,
  SpawnedManagedTask,
  SpawnManagedTaskOptions,
  TaskSupervisor,
  TerminateTaskResult,
} from "./application/task-supervisor.js";
export {
  createTaskSupervisor,
  defaultTaskSupervisor,
  managedTaskShellCommand,
} from "./application/task-supervisor.js";
