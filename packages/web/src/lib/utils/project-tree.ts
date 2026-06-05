import type { AgentRecord, ProjectRecord, SessionRecord } from "../api";
import { shortModelLabel } from "./model";

export type ConversationRow = {
  session: SessionRecord;
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
  updatedAt: string;
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
  let path = dir.replace(/[\\/]+$/, "");
  if (homeDir && (path === homeDir || path.startsWith(`${homeDir}/`))) {
    path = `~${path.slice(homeDir.length)}`;
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
  const mode = row.agent?.mode ?? row.session.mode;
  const permission = row.agent?.permissionLevel ?? row.session.permissionLevel;
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
        row.session.title.toLowerCase().includes(normalized) ||
        row.session.id.toLowerCase().includes(normalized),
    )
  );
}

export function activeSessionAgent(
  session: SessionRecord,
  agents: AgentRecord[],
): AgentRecord | undefined {
  return (
    agents.find((agent) => agent.id === session.activeAgentId) ??
    agents.find((agent) => agent.sessionId === session.id)
  );
}

export function buildProjectGroups(options: {
  projects: ProjectRecord[];
  sessions: SessionRecord[];
  agents: AgentRecord[];
  filter?: string;
  homeDir?: string;
  maxProjects?: number;
  maxRowsPerProject?: number;
}): ProjectGroupResult {
  const { projects, sessions, agents, homeDir } = options;
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
      if (project.updatedAt > existing.updatedAt)
        existing.updatedAt = project.updatedAt;
      if (project.updatedAt > existing.project.updatedAt)
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
        updatedAt: project.updatedAt,
      });
    }
  }

  for (const session of sessions) {
    const project = projectById.get(session.projectId);
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
      updatedAt: project.updatedAt,
    };
    group.rows.push({ session, agent: activeSessionAgent(session, agents) });
    if (session.updatedAt > group.updatedAt)
      group.updatedAt = session.updatedAt;
    byDir.set(key, group);
  }

  const sorted = [...byDir.values()]
    .filter((group) => projectGroupMatches(group, query))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

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
      b.session.updatedAt.localeCompare(a.session.updatedAt),
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
