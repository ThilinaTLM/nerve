import { compareConversationsByLastUserPromptDesc } from "@nervekit/contracts/core";
import type { AgentRecord } from "$lib/domain/projects/sidebar-view-models";
import type { ConversationRecord } from "$lib/domain/projects/sidebar-view-models";

import { permissionRuleSetDisplayName } from "$lib/domain/permissions/rule-set-options";

function shortModelLabel(modelId: string): string {
  return modelId.replace(/^claude-/, "claude ").replace(/^gpt-/, "gpt ");
}

export type ConversationRow = {
  conversation: ConversationRecord;
  agent?: AgentRecord;
};

export function projectKey(
  project: { dir: string } | { directory: string },
): string {
  const dir = "dir" in project ? project.dir : project.directory;
  return dir.replace(/[\\/]+$/, "") || dir;
}

/** Last path segment (folder name) of a project directory. */
export function projectFolderName(dir: string): string {
  const path = dir.replace(/[\\/]+$/, "");
  const segments = path.split(/[\\/]/);
  return segments[segments.length - 1] || path;
}

export function shortProjectLabel(dir: string, homeDir?: string): string {
  let path = dir.replace(/\\/g, "/").replace(/\/+$/, "");
  const homePath = homeDir?.replace(/\\/g, "/").replace(/\/+$/, "");
  const comparablePath = /^[A-Za-z]:\//.test(path) ? path.toLowerCase() : path;
  const comparableHome =
    homePath && /^[A-Za-z]:\//.test(homePath)
      ? homePath.toLowerCase()
      : homePath;
  if (
    homePath &&
    comparableHome &&
    (comparablePath === comparableHome ||
      comparablePath.startsWith(`${comparableHome}/`))
  ) {
    path = `~${path.slice(homePath.length)}`;
  }
  const segments = path.split("/");
  return segments
    .map((segment, index) => {
      if (index === segments.length - 1 || segment === "" || segment === "~") {
        return segment;
      }
      return segment.startsWith(".") ? segment.slice(0, 2) : segment.charAt(0);
    })
    .join("/");
}

export function shortAgentModel(agent: AgentRecord | undefined): string {
  if (!agent?.model) return "model pending";
  return shortModelLabel(agent.model.modelId);
}

/** Tooltip lines describing a row's agent configuration. */
export function conversationRowDetails(row: ConversationRow): string[] {
  const profile = row.agent?.agentProfile ?? row.conversation.agentProfile;
  const permission =
    row.agent?.permissionRuleSetId ?? row.conversation.permissionRuleSetId;
  return [
    `profile: ${profile ?? "unknown"} · rule set: ${permission ? permissionRuleSetDisplayName(permission) : "unknown"}`,
    `model: ${shortAgentModel(row.agent)}`,
  ];
}

export function activeConversationAgent(
  conversation: ConversationRecord,
  agents: AgentRecord[],
): AgentRecord | undefined {
  return (
    agents.find((agent) => agent.id === conversation.activeAgentId) ??
    agents.find((agent) => agent.conversationId === conversation.id)
  );
}

export function buildConversationRows(options: {
  conversations: ConversationRecord[];
  agents: AgentRecord[];
  projectIds: Iterable<string>;
  filter?: string;
}): ConversationRow[] {
  const { conversations, agents } = options;
  const projectIds = new Set(options.projectIds);
  const query = options.filter?.trim().toLowerCase() ?? "";
  return conversations
    .filter((conversation) => projectIds.has(conversation.projectId))
    .filter(
      (conversation) =>
        !query ||
        conversation.title.toLowerCase().includes(query) ||
        conversation.id.toLowerCase().includes(query),
    )
    .map((conversation) => ({
      conversation,
      agent: activeConversationAgent(conversation, agents),
    }))
    .sort((a, b) =>
      compareConversationsByLastUserPromptDesc(a.conversation, b.conversation),
    );
}
