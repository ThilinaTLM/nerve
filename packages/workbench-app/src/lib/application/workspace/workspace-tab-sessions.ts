import { workspaceFeaturePorts } from "./workspace-feature-ports.svelte";
import type { GitDiffArea } from "@nervekit/contracts/git";
import type { MermaidBlockLocator } from "@nervekit/ui-kit/renderers/mermaid/mermaid-blocks";
import type { ConversationRecord, ProjectRecord, TaskRecord } from "$lib/api";
import { projectKey } from "$lib/domain/projects/project-tree";
import {
  diffViewKey,
  fileViewKey,
  mermaidViewKey,
  prViewKey,
} from "$lib/domain/navigation/view-keys";
import { fileViewerPreferences } from "$lib/application/workspace/file-viewer-preferences.svelte";
import { syncCenterTabMirrors } from "./center-tab-mirrors.svelte";
import type {
  CenterTabIdentity,
  ProjectTabSession,
} from "./workspace-state.svelte";
import { workspaceState } from "./workspace-state.svelte";
import {
  mostRecentTab,
  reorderTabs,
  tabIdentityKey,
} from "./tab-session-helpers";

const storageKey = "nerve.workspaceTabs.v2";
const legacyStorageKey = "nerve.conversationTabs.v1";
const maxSessions = 24;
const maxTabs = 30;
const globalKinds = new Set<CenterTabIdentity["kind"]>([
  "settings",
  "logs",
  "discover",
]);
let hydrated = false;

export const tabKey = tabIdentityKey;

export function tabsEqual(
  a: CenterTabIdentity | undefined,
  b: CenterTabIdentity | undefined,
): boolean {
  return Boolean(a && b && a.kind === b.kind && a.id === b.id);
}

export function isGlobalCenterTab(tab: CenterTabIdentity): boolean {
  return globalKinds.has(tab.kind);
}

function uniqueTabs(tabs: CenterTabIdentity[]): CenterTabIdentity[] {
  const seen = new Set<string>();
  return tabs
    .filter((tab) => {
      const key = tabKey(tab);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, maxTabs);
}

function normalizeSession(session: ProjectTabSession): ProjectTabSession {
  const tabs = uniqueTabs(session.tabs);
  const keys = new Set(tabs.map(tabKey));
  const mru = [...new Set(session.mru)].filter((key) => keys.has(key));
  for (const tab of tabs) if (!mru.includes(tabKey(tab))) mru.push(tabKey(tab));
  return {
    tabs,
    active:
      session.active && keys.has(tabKey(session.active))
        ? session.active
        : tabs[0],
    mru,
  };
}

export function saveVisibleProjectSession(): void {
  const key = workspaceState.selectedProjectKey;
  if (!key) return;
  workspaceState.projectTabSessions[key] = normalizeSession({
    tabs: [...workspaceState.openCenterTabs],
    active: workspaceState.activeCenterTab,
    mru: [...workspaceState.centerTabMru],
  });
  persistWorkspaceTabSessions();
}

export function visibleSessionFor(key: string): ProjectTabSession {
  const session = normalizeSession(
    workspaceState.projectTabSessions[key] ?? { tabs: [], mru: [] },
  );
  const present = new Set(session.tabs.map(tabKey));
  for (const globalTab of workspaceState.globalCenterTabs) {
    if (!present.has(tabKey(globalTab))) session.tabs.push(globalTab);
  }
  return normalizeSession(session);
}

export function applyVisibleSession(
  key: string,
  options: { deferActivation?: boolean } = {},
): ProjectTabSession {
  const session = visibleSessionFor(key);
  workspaceState.selectedProjectKey = key;
  workspaceState.openCenterTabs = [...session.tabs];
  workspaceState.activeCenterTab = options.deferActivation
    ? undefined
    : session.active;
  workspaceState.centerTabMru = [...session.mru];
  workspaceState.projectTabSessions[key] = session;
  syncCenterTabMirrors();
  return session;
}

export function recordTabActivation(tab: CenterTabIdentity): void {
  const key = tabKey(tab);
  workspaceState.centerTabMru = [
    key,
    ...workspaceState.centerTabMru.filter((item) => item !== key),
  ];
  if (
    isGlobalCenterTab(tab) &&
    !workspaceState.globalCenterTabs.some((candidate) =>
      tabsEqual(candidate, tab),
    )
  ) {
    workspaceState.globalCenterTabs = [...workspaceState.globalCenterTabs, tab];
  }
  if (workspaceState.selectedProjectKey) saveVisibleProjectSession();
  else persistWorkspaceTabSessions();
}

export function recordTabsChanged(): void {
  const open = new Set(workspaceState.openCenterTabs.map(tabKey));
  workspaceState.centerTabMru = workspaceState.centerTabMru.filter((key) =>
    open.has(key),
  );
  saveVisibleProjectSession();
}

export function removeGlobalTabFromSessions(tab: CenterTabIdentity): void {
  workspaceState.globalCenterTabs = workspaceState.globalCenterTabs.filter(
    (candidate) => !tabsEqual(candidate, tab),
  );
  for (const [key, session] of Object.entries(
    workspaceState.projectTabSessions,
  )) {
    workspaceState.projectTabSessions[key] = normalizeSession({
      tabs: session.tabs.filter((candidate) => !tabsEqual(candidate, tab)),
      active: tabsEqual(session.active, tab) ? undefined : session.active,
      mru: session.mru.filter((candidate) => candidate !== tabKey(tab)),
    });
  }
  persistWorkspaceTabSessions();
}

export function mostRecentRemainingTab(
  excluding: CenterTabIdentity | CenterTabIdentity[],
): CenterTabIdentity | undefined {
  return mostRecentTab(
    workspaceState.openCenterTabs,
    workspaceState.centerTabMru,
    Array.isArray(excluding) ? excluding : [excluding],
  );
}

export function reorderVisibleTab(
  tab: CenterTabIdentity,
  targetIndex: number,
): void {
  workspaceState.openCenterTabs = reorderTabs(
    workspaceState.openCenterTabs,
    tab,
    targetIndex,
  );
  saveVisibleProjectSession();
}

export function removeTabsFromAllSessions(
  predicate: (tab: CenterTabIdentity) => boolean,
): void {
  for (const [key, session] of Object.entries(
    workspaceState.projectTabSessions,
  )) {
    const tabs = session.tabs.filter((tab) => !predicate(tab));
    const keys = new Set(tabs.map(tabKey));
    workspaceState.projectTabSessions[key] = normalizeSession({
      tabs,
      active:
        session.active && keys.has(tabKey(session.active))
          ? session.active
          : undefined,
      mru: session.mru.filter((item) => keys.has(item)),
    });
  }
  workspaceState.openCenterTabs = workspaceState.openCenterTabs.filter(
    (tab) => !predicate(tab),
  );
  recordTabsChanged();
}

type StoredTab = CenterTabIdentity & {
  projectId?: string;
  path?: string;
  line?: number;
  displayMode?: "raw" | "rendered";
  wrapLines?: boolean;
  repo?: string;
  number?: number;
  renamedFrom?: string;
  area?: GitDiffArea;
  locator?: MermaidBlockLocator;
  source?: string;
  sourceKey?: string;
  name?: string;
};

type StoredSession = {
  tabs: StoredTab[];
  active?: CenterTabIdentity;
  mru: string[];
};

type StoredPayload = {
  selectedProjectKey?: string;
  projectRecency?: Record<string, number>;
  sessions?: Record<string, StoredSession>;
  globals?: CenterTabIdentity[];
};

function isIdentity(value: unknown): value is CenterTabIdentity {
  if (!value || typeof value !== "object") return false;
  const tab = value as { kind?: unknown; id?: unknown };
  if (typeof tab.kind !== "string" || typeof tab.id !== "string") return false;
  if (tab.kind === "settings") return tab.id === "settings";
  if (tab.kind === "logs") return tab.id === "logs";
  if (tab.kind === "discover") return tab.id === "discover";
  return [
    "conversation",
    "pending-conversation",
    "task",
    "file",
    "mermaid",
    "pr",
    "diff",
  ].includes(tab.kind);
}

function isMermaidBlockLocator(value: unknown): value is MermaidBlockLocator {
  if (!value || typeof value !== "object") return false;
  const locator = value as Partial<MermaidBlockLocator>;
  return (
    Number.isInteger(locator.ordinal) &&
    (locator.ordinal ?? -1) >= 0 &&
    Number.isInteger(locator.startLine) &&
    (locator.startLine ?? 0) > 0 &&
    typeof locator.fingerprint === "string" &&
    locator.fingerprint.length > 0
  );
}

function parseSession(value: unknown): ProjectTabSession | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as { tabs?: unknown; active?: unknown; mru?: unknown };
  const storedTabs = Array.isArray(raw.tabs)
    ? (raw.tabs.filter(isIdentity) as StoredTab[])
    : [];
  const tabs: CenterTabIdentity[] = [];
  for (const stored of storedTabs) {
    if (stored.kind === "file") {
      if (!stored.projectId || !stored.path) continue;
      workspaceFeaturePorts().filesystem.commands.restoreFileView(stored.id, {
        id: stored.id,
        projectId: stored.projectId,
        path: stored.path,
        line: stored.line,
        displayMode: stored.displayMode,
        wrapLines: stored.wrapLines,
        loading: false,
      });
    } else if (stored.kind === "mermaid") {
      if (!stored.projectId || !isMermaidBlockLocator(stored.locator)) continue;
      if (stored.path) {
        workspaceFeaturePorts().filesystem.commands.restoreMermaidView(
          stored.id,
          {
            origin: "file",
            id: stored.id,
            projectId: stored.projectId,
            path: stored.path,
            locator: stored.locator,
            loading: false,
          },
        );
      } else if (
        typeof stored.source === "string" &&
        stored.source.trim() &&
        typeof stored.sourceKey === "string" &&
        stored.sourceKey &&
        typeof stored.name === "string" &&
        stored.name
      ) {
        workspaceFeaturePorts().filesystem.commands.restoreMermaidView(
          stored.id,
          {
            origin: "inline",
            id: stored.id,
            projectId: stored.projectId,
            sourceKey: stored.sourceKey,
            name: stored.name,
            locator: stored.locator,
            source: stored.source,
            loading: false,
          },
        );
      } else {
        continue;
      }
    } else if (stored.kind === "pr") {
      if (
        !stored.projectId ||
        !stored.repo ||
        typeof stored.number !== "number"
      )
        continue;
      workspaceFeaturePorts().git.commands.restorePrView(stored.id, {
        id: stored.id,
        projectId: stored.projectId,
        repo: stored.repo,
        number: stored.number,
        core: { loading: false, refreshing: false },
        conversation: { loading: false, refreshing: false },
        overview: { loading: false, refreshing: false },
        commits: { loading: false, refreshing: false },
        checks: { loading: false, refreshing: false },
        files: { loading: false, refreshing: false },
        fileDiffs: {},
        activeTab: "conversation",
        refreshing: false,
        merging: false,
      });
    } else if (stored.kind === "diff") {
      if (
        !stored.projectId ||
        !stored.repo ||
        !stored.path ||
        (stored.area !== "staged" && stored.area !== "unstaged")
      )
        continue;
      workspaceFeaturePorts().git.commands.restoreDiffView(stored.id, {
        id: stored.id,
        projectId: stored.projectId,
        repo: stored.repo,
        path: stored.path,
        renamedFrom: stored.renamedFrom,
        area: stored.area,
        wrapLines: fileViewerPreferences.wrapLongLines,
        loading: false,
        refreshing: false,
      });
    }
    tabs.push({ kind: stored.kind, id: stored.id } as CenterTabIdentity);
  }
  const active = isIdentity(raw.active) ? raw.active : undefined;
  const mru = Array.isArray(raw.mru)
    ? raw.mru.filter((item): item is string => typeof item === "string")
    : [];
  return normalizeSession({ tabs, active, mru });
}

function readPayload(): StoredPayload | undefined {
  if (typeof localStorage === "undefined") return undefined;
  try {
    return JSON.parse(localStorage.getItem(storageKey) ?? "null") as
      | StoredPayload
      | undefined;
  } catch {
    return undefined;
  }
}

function legacySessions(
  projects: ProjectRecord[],
  conversations: ConversationRecord[],
): Record<string, ProjectTabSession> {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = JSON.parse(
      localStorage.getItem(legacyStorageKey) ?? "null",
    ) as { tabIds?: unknown; activeId?: unknown } | null;
    const ids = Array.isArray(raw?.tabIds)
      ? raw.tabIds.filter((id): id is string => typeof id === "string")
      : [];
    const sessions: Record<string, ProjectTabSession> = {};
    for (const id of ids) {
      const conversation = conversations.find(
        (candidate) => candidate.id === id,
      );
      const project =
        conversation &&
        projects.find((candidate) => candidate.id === conversation.projectId);
      if (!project) continue;
      const key = projectKey(project);
      sessions[key] ??= { tabs: [], mru: [] };
      const tab = { kind: "conversation" as const, id };
      sessions[key].tabs.push(tab);
      sessions[key].mru.push(tabKey(tab));
      if (raw?.activeId === id) sessions[key].active = tab;
    }
    return sessions;
  } catch {
    return {};
  }
}

export function hydrateWorkspaceTabSessions(
  input: {
    projects: ProjectRecord[];
    conversations: ConversationRecord[];
    tasks: TaskRecord[];
  },
  options: { deferActivation?: boolean } = {},
): CenterTabIdentity | undefined {
  if (hydrated) return;
  hydrated = true;
  const projectKeys = new Set(input.projects.map(projectKey));
  const conversationIds = new Set(input.conversations.map((item) => item.id));
  const taskIds = new Set(
    input.tasks.map(
      (task) => task.definitionId ?? task.restartRootTaskId ?? task.id,
    ),
  );
  const stored = readPayload();
  const rawSessions =
    stored?.sessions ?? legacySessions(input.projects, input.conversations);
  const sessions: Record<string, ProjectTabSession> = {};
  for (const [key, raw] of Object.entries(rawSessions).slice(0, maxSessions)) {
    if (!projectKeys.has(key)) continue;
    const parsed = parseSession(raw);
    if (!parsed) continue;
    parsed.tabs = parsed.tabs.filter((tab) => {
      if (tab.kind === "pending-conversation") return false;
      if (tab.kind === "file")
        return Boolean(
          workspaceFeaturePorts().filesystem.read.fileViews[
            fileViewKey(tab.id)
          ],
        );
      if (tab.kind === "mermaid")
        return Boolean(
          workspaceFeaturePorts().filesystem.read.mermaidViews[
            mermaidViewKey(tab.id)
          ],
        );
      if (tab.kind === "pr")
        return Boolean(
          workspaceFeaturePorts().git.read.prViews[prViewKey(tab.id)],
        );
      if (tab.kind === "diff")
        return Boolean(
          workspaceFeaturePorts().git.read.diffViews[diffViewKey(tab.id)],
        );
      if (tab.kind === "conversation") return conversationIds.has(tab.id);
      if (tab.kind === "task") return taskIds.has(tab.id);
      return true;
    });
    sessions[key] = normalizeSession(parsed);
  }
  workspaceState.projectTabSessions = sessions;
  workspaceState.globalCenterTabs = (stored?.globals ?? [])
    .filter(isIdentity)
    .filter(isGlobalCenterTab);
  let desiredTab: CenterTabIdentity | undefined;
  if (!stored?.selectedProjectKey) {
    workspaceState.openCenterTabs = [...workspaceState.globalCenterTabs];
    desiredTab = workspaceState.globalCenterTabs[0];
    workspaceState.activeCenterTab = options.deferActivation
      ? undefined
      : desiredTab;
    workspaceState.centerTabMru = workspaceState.globalCenterTabs.map(tabKey);
    syncCenterTabMirrors();
  }
  workspaceState.projectRecency = stored?.projectRecency ?? {};
  workspaceState.selectedProjectKey =
    stored?.selectedProjectKey && projectKeys.has(stored.selectedProjectKey)
      ? stored.selectedProjectKey
      : undefined;
  if (typeof localStorage !== "undefined" && !stored)
    localStorage.removeItem(legacyStorageKey);
  return desiredTab;
}

export function persistWorkspaceTabSessions(): void {
  if (typeof localStorage === "undefined") return;
  const sessions = Object.fromEntries(
    Object.entries(workspaceState.projectTabSessions)
      .slice(0, maxSessions)
      .map(([key, session]) => {
        const tabs = session.tabs.flatMap((tab): StoredTab[] => {
          if (tab.kind === "pending-conversation") return [];
          if (tab.kind === "file") {
            const view =
              workspaceFeaturePorts().filesystem.read.fileViews[
                fileViewKey(tab.id)
              ];
            return view
              ? [
                  {
                    ...tab,
                    projectId: view.projectId,
                    path: view.path,
                    line: view.line,
                    displayMode: view.displayMode,
                    wrapLines: view.wrapLines,
                  },
                ]
              : [];
          }
          if (tab.kind === "mermaid") {
            const view =
              workspaceFeaturePorts().filesystem.read.mermaidViews[
                mermaidViewKey(tab.id)
              ];
            if (!view) return [];
            return view.origin === "file"
              ? [
                  {
                    ...tab,
                    projectId: view.projectId,
                    path: view.path,
                    locator: view.locator,
                  },
                ]
              : [
                  {
                    ...tab,
                    projectId: view.projectId,
                    locator: view.locator,
                    source: view.source,
                    sourceKey: view.sourceKey,
                    name: view.name,
                  },
                ];
          }
          if (tab.kind === "pr") {
            const view =
              workspaceFeaturePorts().git.read.prViews[prViewKey(tab.id)];
            return view
              ? [
                  {
                    ...tab,
                    projectId: view.projectId,
                    repo: view.repo,
                    number: view.number,
                  },
                ]
              : [];
          }
          if (tab.kind === "diff") {
            const view =
              workspaceFeaturePorts().git.read.diffViews[diffViewKey(tab.id)];
            return view
              ? [
                  {
                    ...tab,
                    projectId: view.projectId,
                    repo: view.repo,
                    path: view.path,
                    renamedFrom: view.renamedFrom,
                    area: view.area,
                  },
                ]
              : [];
          }
          return [tab];
        });
        const keys = new Set(tabs.map(tabKey));
        const stored: StoredSession = {
          tabs,
          active:
            session.active && keys.has(tabKey(session.active))
              ? session.active
              : undefined,
          mru: session.mru.filter((item) => keys.has(item)),
        };
        return [key, stored];
      }),
  );
  const payload: StoredPayload = {
    selectedProjectKey: workspaceState.selectedProjectKey,
    projectRecency: workspaceState.projectRecency,
    sessions,
    globals: workspaceState.globalCenterTabs,
  };
  localStorage.setItem(storageKey, JSON.stringify(payload));
}
