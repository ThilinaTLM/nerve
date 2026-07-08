import { shortModelLabel } from "@nervekit/shared-ui/core/utils/model";
import type { AgentRecord, ConversationRecord, ProjectRecord } from "$lib/api";

export type ConversationRow = {
  conversation: ConversationRecord;
  agent?: AgentRecord;
};

export type ProjectGroup = {
  key: string;
  project: ProjectRecord;
  projects: ProjectRecord[];
  rows: ConversationRow[];
  hiddenRows: number;
  totalRows: number;
  /** Display label: folder name, or a disambiguated short path on name clashes. */
  label: string;
  sortAt: string;
};

export type ProjectGroupResult = {
  groups: ProjectGroup[];
  hiddenProjects: number;
};

export const MAX_PROJECTS = 5;
export const MAX_ROWS_PER_PROJECT = 5;

export function projectKey(project: ProjectRecord): string {
  return project.dir.replace(/[\\/]+$/, "") || project.dir;
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

export function conversationMeta(row: ConversationRow): string {
  const mode = row.agent?.mode ?? row.conversation.mode;
  const permission =
    row.agent?.permissionLevel ?? row.conversation.permissionLevel;
  return `${mode} · ${permission} · ${shortAgentModel(row.agent)}`;
}

export function groupIsActive(
  group: ProjectGroup,
  selectedProjectId: string | undefined,
): boolean {
  return group.projects.some((project) => project.id === selectedProjectId);
}

export function projectGroupMatches(
  group: ProjectGroup,
  query: string,
): boolean {
  if (!query) return true;
  const normalized = query.toLowerCase();
  return (
    group.project.name.toLowerCase().includes(normalized) ||
    group.project.dir.toLowerCase().includes(normalized) ||
    group.projects.some(
      (project) =>
        project.name.toLowerCase().includes(normalized) ||
        project.dir.toLowerCase().includes(normalized),
    ) ||
    group.rows.some(
      (row) =>
        row.conversation.title.toLowerCase().includes(normalized) ||
        row.conversation.id.toLowerCase().includes(normalized),
    )
  );
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

export function conversationLastUserSortAt(
  conversation: ConversationRecord,
): string {
  return conversation.lastUserMessageAt ?? conversation.createdAt;
}

function compareConversationsByLastUserMessageDesc(
  a: ConversationRecord,
  b: ConversationRecord,
): number {
  const sortCompare = conversationLastUserSortAt(b).localeCompare(
    conversationLastUserSortAt(a),
  );
  if (sortCompare !== 0) return sortCompare;
  const createdCompare = b.createdAt.localeCompare(a.createdAt);
  if (createdCompare !== 0) return createdCompare;
  const titleCompare = a.title.localeCompare(b.title);
  if (titleCompare !== 0) return titleCompare;
  return a.id.localeCompare(b.id);
}

function compareProjectGroupsDesc(a: ProjectGroup, b: ProjectGroup): number {
  const sortCompare = b.sortAt.localeCompare(a.sortAt);
  if (sortCompare !== 0) return sortCompare;
  const createdCompare = b.project.createdAt.localeCompare(a.project.createdAt);
  if (createdCompare !== 0) return createdCompare;
  return a.key.localeCompare(b.key);
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
      compareConversationsByLastUserMessageDesc(a.conversation, b.conversation),
    );
}

export function buildProjectGroups(options: {
  projects: ProjectRecord[];
  conversations: ConversationRecord[];
  agents: AgentRecord[];
  filter?: string;
  homeDir?: string;
  maxProjects?: number;
  maxRowsPerProject?: number;
}): ProjectGroupResult {
  const { projects, conversations, agents, homeDir } = options;
  const query = options.filter?.trim() ?? "";
  const maxProjects = options.maxProjects ?? MAX_PROJECTS;
  const maxRowsPerProject = options.maxRowsPerProject ?? MAX_ROWS_PER_PROJECT;
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const byDir = new Map<string, ProjectGroup>();

  for (const project of projects) {
    const key = projectKey(project);
    const existing = byDir.get(key);
    if (existing) {
      existing.projects.push(project);
      if (project.createdAt > existing.sortAt)
        existing.sortAt = project.createdAt;
      if (project.createdAt > existing.project.createdAt)
        existing.project = project;
    } else {
      byDir.set(key, {
        key,
        project,
        projects: [project],
        rows: [],
        hiddenRows: 0,
        totalRows: 0,
        label: projectFolderName(project.dir),
        sortAt: project.createdAt,
      });
    }
  }

  for (const conversation of conversations) {
    const project = projectById.get(conversation.projectId);
    if (!project) continue;
    const key = projectKey(project);
    const group = byDir.get(key) ?? {
      key,
      project,
      projects: [project],
      rows: [],
      hiddenRows: 0,
      totalRows: 0,
      label: projectFolderName(project.dir),
      sortAt: project.createdAt,
    };
    group.rows.push({
      conversation,
      agent: activeConversationAgent(conversation, agents),
    });
    const conversationSortAt = conversationLastUserSortAt(conversation);
    if (conversationSortAt > group.sortAt) group.sortAt = conversationSortAt;
    byDir.set(key, group);
  }

  const sorted = [...byDir.values()]
    .filter((group) => projectGroupMatches(group, query))
    .sort(compareProjectGroupsDesc);

  const hiddenProjects = Math.max(0, sorted.length - maxProjects);

  // Folder names are the primary label; fall back to a disambiguated short path
  // only when two visible projects share the same folder name.
  const folderNameCounts = new Map<string, number>();
  for (const group of sorted) {
    const folder = projectFolderName(group.project.dir);
    folderNameCounts.set(folder, (folderNameCounts.get(folder) ?? 0) + 1);
  }

  const groups = sorted.slice(0, maxProjects).map((group) => {
    const rows = group.rows.sort((a, b) =>
      compareConversationsByLastUserMessageDesc(a.conversation, b.conversation),
    );
    const folder = projectFolderName(group.project.dir);
    const label =
      (folderNameCounts.get(folder) ?? 0) > 1
        ? shortProjectLabel(group.project.dir, homeDir)
        : folder;
    return {
      ...group,
      label,
      totalRows: rows.length,
      hiddenRows: Math.max(0, rows.length - maxRowsPerProject),
      rows: rows.slice(0, maxRowsPerProject),
    };
  });

  return { groups, hiddenProjects };
}
