import type {
  AgentRecord,
  CompletionItem,
  FilesystemFileResponse,
  ProjectRecord,
  TaskRecord,
} from "$lib/api";
import type { GitDiffArea } from "@nervekit/contracts/git";
import type { FileDisplayMode } from "@nervekit/ui-kit/display/file-display";
import type { MermaidBlockLocator } from "@nervekit/ui-kit/renderers/mermaid/mermaid-blocks";

export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

type VoiceInputTarget =
  | { kind: "conversation"; id: string }
  | { kind: "pending-conversation"; id: string };

interface ConversationWorkspaceView {
  readonly treeNodes: readonly unknown[];
  readonly composerText: string;
  readonly error?: string;
  readonly activeRun?: { readonly status: string };
  readonly transient?: { readonly compaction?: { readonly state: string } };
  readonly sending?: boolean;
}

interface PendingConversationWorkspaceView {
  readonly id: string;
  readonly projectId: string;
  readonly projectDir: string;
  readonly title: "New Conversation";
  readonly composerText: string;
  readonly mode: AgentRecord["mode"];
  readonly sending: boolean;
  readonly error?: string;
}

interface FileWorkspaceView {
  readonly projectId: string;
  readonly path: string;
  readonly line?: number;
  readonly content?: FilesystemFileResponse;
  readonly displayMode?: FileDisplayMode;
  readonly wrapLines?: boolean;
  readonly loading: boolean;
  readonly error?: string;
}

interface MermaidWorkspaceView {
  readonly projectId: string;
  readonly origin: "file" | "inline";
  readonly path?: string;
  readonly relativePath?: string;
  readonly name?: string;
  readonly source?: string;
  readonly sourceKey?: string;
  readonly locator: MermaidBlockLocator;
  readonly loading: boolean;
  readonly error?: string;
}

interface DiffWorkspaceView {
  readonly projectId: string;
  readonly path: string;
  readonly renamedFrom?: string;
  readonly repo: string;
  readonly area: GitDiffArea;
  readonly loading: boolean;
  readonly refreshing: boolean;
  readonly error?: string;
}

interface PrWorkspaceView {
  readonly projectId: string;
  readonly repo: string;
  readonly number: number;
  readonly core: {
    readonly data?: { readonly title: string; readonly isDraft: boolean };
    readonly loading: boolean;
    readonly refreshing: boolean;
    readonly error?: string;
  };
  readonly checks: {
    readonly data?: {
      readonly checks: {
        readonly status: "none" | "pending" | "passing" | "failing";
      };
    };
  };
}

export interface WorkspaceFeaturePorts {
  conversations: {
    read: {
      readonly activeConversationTabId: string | undefined;
      readonly conversationViews: Readonly<
        Record<string, ConversationWorkspaceView>
      >;
      readonly pendingConversations: Readonly<
        Record<string, PendingConversationWorkspaceView>
      >;
      readonly openConversationTabIds: readonly string[];
      readonly slashCompletions: readonly CompletionItem[];
      readonly selectedModelKey: string;
      readonly selectedThinkingLevel: AgentRecord["thinkingLevel"];
      readonly selectedMode: AgentRecord["mode"];
      readonly selectedPermissionLevel: AgentRecord["permissionLevel"];
      readonly selectedPermissionRuleSetId: string;
    };
    commands: {
      setOpenConversationTabIds(ids: string[]): void;
      setSlashCompletions(completions: CompletionItem[]): void;
      discardConversationView(id: string): void;
      discardPendingConversation(id: string): void;
      setActiveConversationTab(id: string | undefined): void;
      applyAgentConfiguration(agent: AgentRecord): void;
      applyConversationConfiguration(input: {
        mode: AgentRecord["mode"];
        permissionLevel: AgentRecord["permissionLevel"];
        permissionRuleSetId?: string;
      }): void;
      cancelVoiceInputTargets(targets: VoiceInputTarget[]): Promise<void>;
      openPendingConversation(
        project: ProjectRecord,
        initialMode?: AgentRecord["mode"],
      ): void;
      removeConversationTabs(conversationIds: string[]): Promise<void>;
    };
  };
  filesystem: {
    read: {
      readonly fileViews: Readonly<Record<string, FileWorkspaceView>>;
      readonly mermaidViews: Readonly<Record<string, MermaidWorkspaceView>>;
      readonly openFileTabIds: readonly string[];
    };
    commands: {
      setOpenFileTabIds(ids: string[]): void;
      restoreFileView(id: string, view: unknown): void;
      restoreMermaidView(id: string, view: unknown): void;
      discardFileView(id: string): void;
      discardMermaidView(id: string): void;
    };
  };
  git: {
    read: {
      readonly diffViews: Readonly<Record<string, DiffWorkspaceView>>;
      readonly prViews: Readonly<Record<string, PrWorkspaceView>>;
      readonly openDiffTabIds: readonly string[];
      readonly openPrTabIds: readonly string[];
    };
    commands: {
      setOpenDiffTabIds(ids: string[]): void;
      setOpenPrTabIds(ids: string[]): void;
      restorePrView(id: string, view: unknown): void;
      restoreDiffView(id: string, view: unknown): void;
      discardDiffView(id: string): void;
    };
  };
  logs: {
    read: { readonly tabOpen: boolean };
    commands: { setTabOpen(open: boolean): void };
  };
  settings: {
    read: {
      readonly message: string | undefined;
      readonly saveStatus: string;
      readonly tabOpen: boolean;
    };
    commands: { setTabOpen(open: boolean): void };
  };
  tasks: {
    read: {
      readonly tasks: readonly TaskRecord[];
      readonly openTaskTabIds: readonly string[];
      readonly selectedTaskId: string | undefined;
      readonly selectedRunByEntry: Readonly<Record<string, string>>;
      readonly taskLogs: unknown;
    };
    commands: {
      setTasks(tasks: TaskRecord[]): void;
      setOpenTaskTabIds(ids: string[]): void;
      setSelectedTaskId(id: string | undefined): void;
      clearTaskLogs(): void;
      resolveSelectedTaskId(
        tasks: readonly TaskRecord[],
        selectedTaskId: string | undefined,
      ): string | undefined;
      loadTaskLogWindow(taskId: string): Promise<unknown>;
    };
  };
}

let registeredPorts: WorkspaceFeaturePorts | undefined;

export function registerWorkspaceFeaturePorts(
  ports: WorkspaceFeaturePorts,
): () => void {
  registeredPorts = ports;
  return () => {
    if (registeredPorts === ports) registeredPorts = undefined;
  };
}

export function workspaceFeaturePorts(): WorkspaceFeaturePorts {
  if (!registeredPorts)
    throw new Error("Workspace feature ports are not registered");
  return registeredPorts;
}
