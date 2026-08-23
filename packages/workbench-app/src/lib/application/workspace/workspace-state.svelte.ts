import { SvelteMap } from "svelte/reactivity";
import type {
  AgentRecord,
  ClientConfig,
  ConversationRecord,
  ProjectRecord,
  StatusResponse,
  ToolCallTranscriptRecord,
} from "$lib/api";

export type CenterTabIdentity =
  | { kind: "conversation"; id: string }
  | { kind: "pending-conversation"; id: string }
  | { kind: "task"; id: string }
  | { kind: "file"; id: string }
  | { kind: "mermaid"; id: string }
  | { kind: "pr"; id: string }
  | { kind: "diff"; id: string }
  | { kind: "settings"; id: "settings" }
  | { kind: "logs"; id: "logs" }
  | { kind: "discover"; id: "discover" };

export type ProjectTabSession = {
  tabs: CenterTabIdentity[];
  active?: CenterTabIdentity;
  mru: string[];
};

export const workspaceState = $state({
  status: undefined as StatusResponse | undefined,
  config: undefined as ClientConfig | undefined,
  connection: "connecting",
  eventCursors: new SvelteMap<string, number>(),
  protocolSessionId: undefined as string | undefined,
  error: undefined as string | undefined,
  projects: [] as ProjectRecord[],
  conversations: [] as ConversationRecord[],
  agents: [] as AgentRecord[],
  pendingToolCalls: [] as ToolCallTranscriptRecord[],
  selectedProjectId: undefined as string | undefined,
  selectedProjectKey: undefined as string | undefined,
  projectRecency: {} as Record<string, number>,
  projectTabSessions: {} as Record<string, ProjectTabSession>,
  globalCenterTabs: [] as CenterTabIdentity[],
  openCenterTabs: [] as CenterTabIdentity[],
  activeCenterTab: undefined as CenterTabIdentity | undefined,
  centerTabMru: [] as string[],
  projectPickerOpen: false,
});
