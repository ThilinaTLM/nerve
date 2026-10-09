import type { ConversationSummary } from "@nervekit/contracts/core";
import type { Project } from "@nervekit/contracts/core";

export type ConversationRow = {
  conversation: ConversationSummary;
};

export type ProjectGroup = {
  key: string;
  project: Project;
  projects: Project[];
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

export const MAX_PROJECTS = 20;
export const MAX_ROWS_PER_PROJECT = 6;

export function projectKey(project: Project): string {
  return project.directory.replace(/[\\/]+$/, "") || project.directory;
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

export function conversationMeta(row: ConversationRow): string {
  return row.conversation.status;
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
    group.project.directory.toLowerCase().includes(normalized) ||
    group.projects.some(
      (project) =>
        project.name.toLowerCase().includes(normalized) ||
        project.directory.toLowerCase().includes(normalized),
    ) ||
    group.rows.some(
      (row) =>
        row.conversation.title.toLowerCase().includes(normalized) ||
        row.conversation.id.toLowerCase().includes(normalized),
    )
  );
}

export function conversationLastUserPromptAt(
  conversation: ConversationSummary,
): string {
  return conversation.lastUserMessageAt ?? conversation.createdAt;
}

function compareConversationsByLastUserPromptDesc(
  a: ConversationSummary,
  b: ConversationSummary,
): number {
  const sortCompare = conversationLastUserPromptAt(b).localeCompare(
    conversationLastUserPromptAt(a),
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
  conversations: ConversationSummary[];
  projectIds: Iterable<string>;
  filter?: string;
}): ConversationRow[] {
  const { conversations } = options;
  const projectIds = new Set(options.projectIds);
  const query = options.filter?.trim().toLowerCase() ?? "";
  return conversations
    .filter(
      (conversation) =>
        projectIds.has(conversation.projectId) &&
        conversation.parentConversationId === null,
    )
    .filter(
      (conversation) =>
        !query ||
        conversation.title.toLowerCase().includes(query) ||
        conversation.id.toLowerCase().includes(query),
    )
    .map((conversation) => ({
      conversation,
    }))
    .sort((a, b) =>
      compareConversationsByLastUserPromptDesc(a.conversation, b.conversation),
    );
}

function compareConversationRowsByCompletionThenUserPrompt(
  a: ConversationRow,
  b: ConversationRow,
): number {
  const completionCompare =
    Number(Boolean(a.conversation.completedAt)) -
    Number(Boolean(b.conversation.completedAt));
  return (
    completionCompare ||
    compareConversationsByLastUserPromptDesc(a.conversation, b.conversation)
  );
}

export type ConversationSection = {
  key: "pinned" | "today" | "yesterday" | "previous-7-days" | "older";
  label: string;
  rows: ConversationRow[];
};

const CONVERSATION_SECTION_LABELS: Record<ConversationSection["key"], string> =
  {
    pinned: "Pinned",
    today: "Today",
    yesterday: "Yesterday",
    "previous-7-days": "Previous 7 days",
    older: "Older",
  };

function startOfLocalDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function conversationDateSectionKey(
  conversation: ConversationSummary,
  now: Date,
): Exclude<ConversationSection["key"], "pinned"> {
  const lastUserPrompt = new Date(conversationLastUserPromptAt(conversation));
  if (Number.isNaN(lastUserPrompt.getTime())) return "older";
  const today = startOfLocalDay(now);
  const lastUserPromptDay = startOfLocalDay(lastUserPrompt);
  if (lastUserPromptDay.getTime() >= today.getTime()) return "today";
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (lastUserPromptDay.getTime() >= yesterday.getTime()) return "yesterday";
  const previousWeek = new Date(today);
  previousWeek.setDate(previousWeek.getDate() - 7);
  return lastUserPromptDay.getTime() >= previousWeek.getTime()
    ? "previous-7-days"
    : "older";
}

export function buildConversationSections(options: {
  conversations: ConversationSummary[];
  projectIds: Iterable<string>;
  filter?: string;
  now?: Date;
  hideCompleted?: boolean;
}): ConversationSection[] {
  const rows = buildConversationRows(options).filter(
    (row) => !options.hideCompleted || !row.conversation.completedAt,
  );
  const now = options.now ?? new Date();
  const byKey = new Map<ConversationSection["key"], ConversationRow[]>();
  for (const row of rows) {
    const key = row.conversation.pinnedAt
      ? "pinned"
      : conversationDateSectionKey(row.conversation, now);
    const sectionRows = byKey.get(key) ?? [];
    sectionRows.push(row);
    byKey.set(key, sectionRows);
  }
  const order: ConversationSection["key"][] = [
    "pinned",
    "today",
    "yesterday",
    "previous-7-days",
    "older",
  ];
  return order.flatMap((key) => {
    const sectionRows = byKey.get(key);
    return sectionRows?.length
      ? [
          {
            key,
            label: CONVERSATION_SECTION_LABELS[key],
            rows: sectionRows.sort(
              compareConversationRowsByCompletionThenUserPrompt,
            ),
          },
        ]
      : [];
  });
}

export function limitConversationSections(
  sections: ConversationSection[],
  limit: number,
): ConversationSection[] {
  let remaining = limit;
  return sections.flatMap((section) => {
    if (remaining <= 0) return [];
    const rows = section.rows.slice(0, remaining);
    remaining -= rows.length;
    return rows.length ? [{ ...section, rows }] : [];
  });
}

export function buildProjectGroups(options: {
  projects: Project[];
  conversations: ConversationSummary[];
  filter?: string;
  homeDir?: string;
  maxProjects?: number;
  maxRowsPerProject?: number;
}): ProjectGroupResult {
  const { projects, conversations, homeDir } = options;
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
        label: projectFolderName(project.directory),
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
      label: projectFolderName(project.directory),
      sortAt: project.createdAt,
    };
    group.rows.push({
      conversation,
    });
    const conversationSortAt = conversationLastUserPromptAt(conversation);
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
    const folder = projectFolderName(group.project.directory);
    folderNameCounts.set(folder, (folderNameCounts.get(folder) ?? 0) + 1);
  }

  const groups = sorted.slice(0, maxProjects).map((group) => {
    const rows = group.rows.sort((a, b) =>
      compareConversationsByLastUserPromptDesc(a.conversation, b.conversation),
    );
    const folder = projectFolderName(group.project.directory);
    const label =
      (folderNameCounts.get(folder) ?? 0) > 1
        ? shortProjectLabel(group.project.directory, homeDir)
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
