import type {
  StartTaskRequest,
  TaskLogQuery,
  TaskLogQueryResponse,
  TaskRecord,
} from "@nervekit/contracts";

export interface TaskPanelModel {
  readonly tasks: readonly TaskRecord[];
  readonly selectedTaskId?: string;
  readonly selectedLogs?: TaskLogQueryResponse;
  readonly loading: boolean;
  readonly error?: string;
}

export interface TaskPanelActions {
  readonly refresh: () => void | Promise<void>;
  readonly select: (taskId: string | undefined) => void | Promise<void>;
  readonly start: (request: StartTaskRequest) => void | Promise<void>;
  readonly cancel: (taskId: string) => void | Promise<void>;
  readonly restart: (taskId: string) => void | Promise<void>;
  readonly remove: (taskId: string) => void | Promise<void>;
  readonly prune: () => void | Promise<void>;
  readonly loadLogs: (
    taskId: string,
    query?: TaskLogQuery,
  ) => void | Promise<void>;
}
