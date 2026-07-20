import type {
  CreatePinnedCommandRequest,
  StartTaskRequest,
  TaskLogQuery,
  TaskLogQueryResponse,
  TaskRecord,
  UpdatePinnedCommandRequest,
} from "@nervekit/contracts";
import type { FeatureCapability } from "../git/git-panel-types.js";

export interface NormalizedPinnedCommand {
  readonly id: string;
  readonly label?: string;
  readonly command: string;
  readonly cwd?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TaskPanelCapabilities {
  readonly start: FeatureCapability;
  readonly cancel: FeatureCapability;
  readonly restart: FeatureCapability;
  readonly remove: FeatureCapability;
  readonly prune: FeatureCapability;
  readonly pin: FeatureCapability;
  readonly copy: FeatureCapability;
  readonly logs: FeatureCapability;
  readonly managePinned: FeatureCapability;
}

export type TaskPanelSectionState = {
  readonly pinned: boolean;
  readonly running: boolean;
  readonly needsCleanup: boolean;
  readonly finished: boolean;
};

export const defaultTaskPanelSectionState: TaskPanelSectionState = {
  pinned: true,
  running: true,
  needsCleanup: true,
  finished: true,
};

export interface TaskPanelModel {
  readonly availability:
    | { readonly available: true }
    | { readonly available: false; readonly message: string };
  readonly notice?: string;
  readonly tasks: readonly TaskRecord[];
  readonly selectedTask?: TaskRecord;
  readonly selectedLogs?: TaskLogQueryResponse;
  readonly logsLoading: boolean;
  readonly logsError?: string;
  readonly pinnedCommands: readonly NormalizedPinnedCommand[];
  readonly defaultCwd: string;
  readonly pinnedLoading: boolean;
  readonly runningPinnedId?: string;
  readonly capabilities: TaskPanelCapabilities;
}

export interface TaskPanelActions {
  readonly selectTask: (taskId: string | undefined) => void | Promise<void>;
  readonly openTaskOutput: (taskId: string) => void | Promise<void>;
  readonly startTask: (request: StartTaskRequest) => void | Promise<void>;
  readonly runPinned: (
    command: NormalizedPinnedCommand,
  ) => void | Promise<void>;
  readonly cancelTask: (taskId: string) => void | Promise<void>;
  readonly restartTask: (taskId: string) => void | Promise<void>;
  readonly removeTask: (taskId: string) => void | Promise<void>;
  readonly pruneTasks: () => void | Promise<void>;
  readonly pinTask: (task: TaskRecord) => void | Promise<void>;
  readonly copyCommand: (command: string) => void | Promise<void>;
  readonly createPinned: (
    input: CreatePinnedCommandRequest,
  ) => void | Promise<void>;
  readonly updatePinned: (
    command: NormalizedPinnedCommand,
    input: UpdatePinnedCommandRequest,
  ) => void | Promise<void>;
  readonly deletePinned: (
    command: NormalizedPinnedCommand,
  ) => void | Promise<void>;
  readonly loadLogs: (
    taskId: string,
    query?: TaskLogQuery,
  ) => void | Promise<void>;
}
