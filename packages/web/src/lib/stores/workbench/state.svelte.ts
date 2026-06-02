import type {
  AgentRecord,
  ApprovalWithToolCall,
  AuthProviderMetadata,
  ClientConfig,
  CompletionItem,
  ModelInfo,
  ProcessLogQueryResponse,
  ProcessRecord,
  ProjectRecord,
  SessionEntry,
  SessionRecord,
  SessionTreeNode,
  Settings,
  StatusResponse,
} from "../../api";

export type TranscriptItem = {
  id?: string;
  role: "user" | "assistant" | "system";
  kind?: SessionEntry["kind"];
  text: string;
};

export const workbenchState = $state({
  status: undefined as StatusResponse | undefined,
  config: undefined as ClientConfig | undefined,
  connection: "connecting",
  error: undefined as string | undefined,
  sending: false,
  projects: [] as ProjectRecord[],
  sessions: [] as SessionRecord[],
  agents: [] as AgentRecord[],
  treeNodes: [] as SessionTreeNode[],
  approvals: [] as ApprovalWithToolCall[],
  processes: [] as ProcessRecord[],
  selectedProcessId: undefined as string | undefined,
  processLogs: undefined as ProcessLogQueryResponse | undefined,
  transcript: [] as TranscriptItem[],
  streamingText: "",
  slashCompletions: [] as CompletionItem[],
  models: [] as ModelInfo[],
  selectedModelKey: "nerve-faux:faux-fast",
  selectedMode: "coding" as AgentRecord["mode"],
  selectedPermissionLevel: "supervised" as AgentRecord["permissionLevel"],
  projectPickerOpen: false,
  settingsDraft: undefined as Settings | undefined,
  authProviders: [] as AuthProviderMetadata[],
  settingsMessage: undefined as string | undefined,
});
