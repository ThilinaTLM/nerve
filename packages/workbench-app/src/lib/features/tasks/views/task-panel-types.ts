import type {
  CancelTaskRequest,
  CreateTaskDefinitionRequest,
  StartTaskRequest,
  TaskLogQuery,
  TaskLogQueryResponse,
  TaskPortConflictListener,
  TaskRecord,
  UpdateTaskDefinitionRequest,
} from "@nervekit/contracts";
import type { FeatureCapability } from "$lib/domain/capabilities/feature-capability";

export interface TaskPanelDefinition {
  readonly id: string;
  readonly label?: string;
  readonly command: string;
  readonly cwd?: string;
  readonly port?: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly runPolicy: "single" | "concurrent";
}

/** A single task run, optionally linked to the definition that started it. */
export interface TaskRunEntry {
  readonly key: string;
  readonly run: TaskRecord;
  readonly definition?: TaskPanelDefinition;
  readonly isActive: boolean;
  readonly canForceKill: boolean;
  readonly isRemovable: boolean;
  readonly needsRecovery: boolean;
}

/** A saved task definition together with every run it has produced. */
export interface TaskDefinitionEntry {
  readonly key: string;
  readonly definition: TaskPanelDefinition;
  /** Run entries linked to this definition, newest first. */
  readonly runs: readonly TaskRunEntry[];
  readonly activeRuns: readonly TaskRecord[];
  readonly latestRun?: TaskRecord;
  readonly needsRecovery: boolean;
}

export interface TaskPanelCapabilities {
  readonly start: FeatureCapability;
  readonly cancel: FeatureCapability;
  readonly restart: FeatureCapability;
  readonly remove: FeatureCapability;
  readonly prune: FeatureCapability;
  readonly copy: FeatureCapability;
  readonly logs: FeatureCapability;
  readonly manageDefinitions: FeatureCapability;
}

/** Plain capability flags handed to row components. */
export type TaskEntryCapabilities = {
  readonly start: boolean;
  readonly cancel: boolean;
  readonly restart: boolean;
  readonly remove: boolean;
  readonly logs: boolean;
  readonly copy: boolean;
  readonly manageDefinitions: boolean;
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
  readonly definitions: readonly TaskPanelDefinition[];
  readonly defaultCwd: string;
  readonly definitionsLoading: boolean;
  readonly runningDefinitionId?: string;
  readonly portConflict?: {
    readonly definition: TaskPanelDefinition;
    readonly port: number;
    readonly listeners: readonly TaskPortConflictListener[];
  };
  readonly capabilities: TaskPanelCapabilities;
}

export interface TaskPanelActions {
  readonly selectTask: (taskId: string | undefined) => void | Promise<void>;
  readonly openTaskOutput: (taskId: string) => void | Promise<void>;
  readonly startTask: (request: StartTaskRequest) => void | Promise<void>;
  readonly runDefinition: (
    definition: TaskPanelDefinition,
  ) => void | Promise<void>;
  readonly confirmPortConflict: () => void | Promise<void>;
  readonly dismissPortConflict: () => void | Promise<void>;
  readonly cancelTask: (
    taskId: string,
    request?: CancelTaskRequest,
  ) => void | Promise<void>;
  readonly forceKillTask: (taskId: string) => void | Promise<void>;
  readonly restartTask: (taskId: string) => void | Promise<void>;
  readonly removeTask: (taskId: string) => void | Promise<void>;
  readonly cleanupRuns: (taskIds: readonly string[]) => void | Promise<void>;
  readonly pruneTasks: () => void | Promise<void>;
  readonly copyText: (text: string) => void | Promise<void>;
  readonly createDefinition: (
    input: CreateTaskDefinitionRequest,
  ) => void | Promise<void>;
  readonly updateDefinition: (
    definition: TaskPanelDefinition,
    input: UpdateTaskDefinitionRequest,
  ) => void | Promise<void>;
  readonly deleteDefinition: (
    definition: TaskPanelDefinition,
  ) => void | Promise<void>;
  readonly loadLogs: (
    taskId: string,
    query?: TaskLogQuery,
  ) => void | Promise<void>;
}
