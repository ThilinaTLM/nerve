import type {
  CancelLaunchRequest,
  StartLaunchRequest,
  LaunchLogQuery,
  LaunchLogQueryResponse,
  LaunchPortConflictListener,
  LaunchRecord,
} from "@nervekit/contracts/launches";
import type {
  CreateLaunchDefinitionRequest,
  LaunchFolder,
  LaunchCatalogEntryRef,
  LaunchDefinition,
  UpdateLaunchDefinitionRequest,
} from "@nervekit/contracts/launch-definitions";
import type { FeatureCapability } from "$lib/domain/capabilities/feature-capability";

export interface LaunchPanelDefinition {
  readonly id: string;
  readonly scope: LaunchDefinition["scope"];
  readonly parentFolderId: string | null;
  readonly order: number;
  readonly label?: string;
  readonly command: string;
  readonly cwd?: string;
  readonly port?: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly runPolicy: "single" | "concurrent";
}

/** A single launch run, optionally linked to the definition that started it. */
export interface LaunchRunEntry {
  readonly key: string;
  readonly run: LaunchRecord;
  readonly definition?: LaunchPanelDefinition;
  /** Linked definition cannot currently be resolved from an authoritative catalog. */
  readonly definitionUnavailable?: boolean;
  readonly isActive: boolean;
  readonly canForceKill: boolean;
  readonly isRemovable: boolean;
}

/** A saved launch definition together with every run it has produced. */
export interface LaunchDefinitionEntry {
  readonly key: string;
  readonly definition: LaunchPanelDefinition;
  /** Run entries linked to this definition, newest first. */
  readonly runs: readonly LaunchRunEntry[];
  readonly activeRuns: readonly LaunchRecord[];
  readonly latestRun?: LaunchRecord;
}

export interface LaunchPanelCapabilities {
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
export type LaunchEntryCapabilities = {
  readonly start: boolean;
  readonly cancel: boolean;
  readonly restart: boolean;
  readonly remove: boolean;
  readonly logs: boolean;
  readonly copy: boolean;
  readonly manageDefinitions: boolean;
};

export interface LaunchPanelModel {
  readonly projectId?: string;
  readonly folders: readonly LaunchFolder[];
  readonly catalogRevision?: string;
  readonly catalogError?: string;
  readonly availability:
    | { readonly available: true }
    | { readonly available: false; readonly message: string };
  readonly notice?: string;
  readonly launches: readonly LaunchRecord[];
  readonly selectedLaunch?: LaunchRecord;
  readonly selectedLogs?: LaunchLogQueryResponse;
  readonly logsLoading: boolean;
  readonly logsError?: string;
  readonly definitions: readonly LaunchPanelDefinition[];
  readonly defaultCwd: string;
  readonly definitionsLoading: boolean;
  readonly runningDefinitionId?: string;
  readonly portConflict?: {
    readonly definition: LaunchPanelDefinition;
    readonly port: number;
    readonly listeners: readonly LaunchPortConflictListener[];
  };
  readonly capabilities: LaunchPanelCapabilities;
}

export interface LaunchPanelActions {
  readonly refreshDefinitions: () => void | Promise<void>;
  readonly createFolder: (input: {
    label: string;
    parentFolderId: string | null;
  }) => void | Promise<void>;
  readonly renameFolder: (
    folder: LaunchFolder,
    label: string,
  ) => void | Promise<void>;
  readonly deleteFolder: (folder: LaunchFolder) => void | Promise<void>;
  readonly moveEntry: (input: {
    /** Drag/menu intent may retain the revision from when it was created. */
    expectedRevision?: string;
    entry: LaunchCatalogEntryRef;
    destinationFolderId: string | null;
    beforeSibling: LaunchCatalogEntryRef | null;
  }) => void | Promise<void>;

  readonly selectLaunch: (launchId: string | undefined) => void | Promise<void>;
  readonly openLaunchOutput: (launchId: string) => void | Promise<void>;
  readonly startLaunch: (request: StartLaunchRequest) => void | Promise<void>;
  readonly runDefinition: (
    definition: LaunchPanelDefinition,
  ) => void | Promise<void>;
  readonly confirmPortConflict: () => void | Promise<void>;
  readonly dismissPortConflict: () => void | Promise<void>;
  readonly cancelLaunch: (
    launchId: string,
    request?: CancelLaunchRequest,
  ) => void | Promise<void>;
  readonly forceKillLaunch: (launchId: string) => void | Promise<void>;
  readonly restartLaunch: (launchId: string) => void | Promise<void>;
  readonly removeLaunch: (launchId: string) => void | Promise<void>;
  readonly cleanupRuns: (launchIds: readonly string[]) => void | Promise<void>;
  readonly pruneLaunches: () => void | Promise<void>;
  readonly copyText: (text: string) => void | Promise<void>;
  readonly createDefinition: (
    input: CreateLaunchDefinitionRequest,
  ) => void | Promise<void>;
  readonly updateDefinition: (
    definition: LaunchPanelDefinition,
    input: UpdateLaunchDefinitionRequest,
  ) => void | Promise<void>;
  readonly deleteDefinition: (
    definition: LaunchPanelDefinition,
  ) => void | Promise<void>;
  readonly loadLogs: (
    launchId: string,
    query?: LaunchLogQuery,
  ) => void | Promise<void>;
}
