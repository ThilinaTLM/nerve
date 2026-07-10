import { defaultFileDisplayMode } from "@nervekit/ui-kit/core/utils/file-display";
import * as api from "../api/manager-client";
import {
  chatTabFor,
  isPendingConversationId,
  selectDurableConversation,
  selectPendingConversation,
} from "./sandbox-conversation-state";
import type {
  SandboxDetailState,
  SandboxDiagnosticTabId,
  SandboxWorkspaceFileViewState,
  SandboxWorkspaceTabIdentity,
} from "./sandbox-ui-types";
import { sandboxSummaryTab } from "./sandbox-ui-types";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sameWorkspaceTab(
  a: SandboxWorkspaceTabIdentity | undefined,
  b: SandboxWorkspaceTabIdentity | undefined,
): boolean {
  return Boolean(a && b && a.kind === b.kind && a.id === b.id);
}

function workspaceFileTabId(path: string): string {
  const normalized = path.trim().replaceAll("\\", "/");
  if (normalized === "/workspace") return "/workspace";
  if (normalized.startsWith("/workspace/"))
    return normalized.slice("/workspace/".length);
  return normalized;
}

function isWorkspaceFileMarkdown(view: SandboxWorkspaceFileViewState): boolean {
  return (
    view.content?.type === "text" &&
    defaultFileDisplayMode(view.content.relativePath || view.path) ===
      "rendered"
  );
}

function ensureWorkspaceTab(
  detail: SandboxDetailState,
  tab: SandboxWorkspaceTabIdentity,
): void {
  if (!detail.openWorkspaceTabs.some((open) => sameWorkspaceTab(open, tab))) {
    detail.openWorkspaceTabs = [...detail.openWorkspaceTabs, tab];
  }
}

export function selectWorkspaceTab(
  detail: SandboxDetailState,
  tab: SandboxWorkspaceTabIdentity,
): void {
  ensureWorkspaceTab(detail, tab);
  detail.activeWorkspaceTab = tab;
  if (tab.kind !== "chat") return;
  if (isPendingConversationId(tab.id)) {
    selectPendingConversation(detail, tab.id);
    return;
  }
  if (tab.id.startsWith("conv_")) {
    selectDurableConversation(detail, tab.id);
    const runs =
      detail.snapshot?.runs.filter((run) => run.conversationId === tab.id) ??
      [];
    const activeRun =
      runs.find((run) => run.status === "running") ??
      [...runs].sort((a, b) =>
        (b.updatedAt ?? b.createdAt ?? "").localeCompare(
          a.updatedAt ?? a.createdAt ?? "",
        ),
      )[0];
    detail.selectedAgentId = activeRun?.agentId;
    detail.selectedRunId = activeRun?.runId;
  }
}

export function closeWorkspaceTab(
  detail: SandboxDetailState,
  tab: SandboxWorkspaceTabIdentity,
): void {
  const index = detail.openWorkspaceTabs.findIndex((open) =>
    sameWorkspaceTab(open, tab),
  );
  if (index < 0) return;
  detail.openWorkspaceTabs = detail.openWorkspaceTabs.filter(
    (open) => !sameWorkspaceTab(open, tab),
  );
  if (tab.kind === "file") delete detail.workspaceFileViewsById[tab.id];
  if (tab.kind === "task") delete detail.taskLogsById[tab.id];
  if (tab.kind === "pr") delete detail.prViewsById[tab.id];
  if (tab.kind === "chat" && isPendingConversationId(tab.id))
    delete detail.pendingConversationsById[tab.id];
  if (sameWorkspaceTab(detail.activeWorkspaceTab, tab)) {
    const next =
      detail.openWorkspaceTabs[index] ??
      detail.openWorkspaceTabs[index - 1] ??
      undefined;
    detail.activeWorkspaceTab = next;
    if (next?.kind === "chat") selectWorkspaceTab(detail, next);
  }
}

export function openWorkspaceChatTab(
  detail: SandboxDetailState,
  key = detail.selectedPendingConversationId ?? detail.selectedConversationId,
): void {
  if (!key) return;
  if (isPendingConversationId(key)) selectPendingConversation(detail, key);
  else if (key.startsWith("conv_")) selectDurableConversation(detail, key);
  selectWorkspaceTab(detail, chatTabFor(key));
}

export function openWorkspaceSummaryTab(detail: SandboxDetailState): void {
  selectWorkspaceTab(detail, sandboxSummaryTab);
}

export function openWorkspaceDiagnosticTab(
  detail: SandboxDetailState,
  id: SandboxDiagnosticTabId,
): void {
  selectWorkspaceTab(detail, { kind: "diagnostic", id });
}

export async function openWorkspaceFile(
  detail: SandboxDetailState,
  sandboxId: string,
  path: string,
  line?: number,
): Promise<void> {
  const trimmedPath = path.trim();
  if (!trimmedPath) return;
  const id = workspaceFileTabId(trimmedPath);
  let view = detail.workspaceFileViewsById[id];
  if (!view) {
    view = {
      id,
      path: trimmedPath,
      line,
      displayMode: defaultFileDisplayMode(trimmedPath),
      wrapLines: false,
      loading: false,
    };
    detail.workspaceFileViewsById[id] = view;
  } else {
    view.path = trimmedPath;
    view.line = line;
  }
  const tab: SandboxWorkspaceTabIdentity = { kind: "file", id };
  ensureWorkspaceTab(detail, tab);
  detail.activeWorkspaceTab = tab;
  await refreshWorkspaceFile(detail, sandboxId, id, line);
}

export async function refreshWorkspaceFile(
  detail: SandboxDetailState,
  sandboxId: string,
  fileTabId: string,
  line?: number,
): Promise<void> {
  const view = detail.workspaceFileViewsById[fileTabId];
  if (!view) return;
  if (line !== undefined) view.line = line;
  view.loading = true;
  view.error = undefined;
  try {
    const content = await api.getSandboxWorkspaceFile(
      sandboxId,
      view.path,
      view.line,
    );
    view.content = content;
    view.path = content.path;
    view.line = content.targetLine ?? view.line;
    if (isWorkspaceFileMarkdown(view)) {
      view.displayMode = view.line
        ? "raw"
        : defaultFileDisplayMode(content.relativePath);
    } else {
      view.displayMode = "raw";
    }
  } catch (error) {
    const message = errorMessage(error);
    view.error = message;
    const { notify } = await import("@nervekit/ui-kit/core/notify");
    notify.error("Could not open file", { description: message });
  } finally {
    view.loading = false;
  }
}

export function toggleWorkspaceFileDisplayMode(
  detail: SandboxDetailState | undefined,
  fileTabId: string,
): void {
  const view = detail?.workspaceFileViewsById[fileTabId];
  if (!view || !isWorkspaceFileMarkdown(view)) return;
  view.displayMode = view.displayMode === "rendered" ? "raw" : "rendered";
}

export function toggleWorkspaceFileLineWrap(
  detail: SandboxDetailState | undefined,
  fileTabId: string,
): void {
  const view = detail?.workspaceFileViewsById[fileTabId];
  if (!view) return;
  view.wrapLines = !view.wrapLines;
}

export function closeWorkspaceTabs(
  detail: SandboxDetailState,
  tabs: SandboxWorkspaceTabIdentity[],
  fallback?: SandboxWorkspaceTabIdentity,
): void {
  for (const tab of tabs) {
    if (tab.kind === "file") delete detail.workspaceFileViewsById[tab.id];
    if (tab.kind === "task") delete detail.taskLogsById[tab.id];
    if (tab.kind === "pr") delete detail.prViewsById[tab.id];
    if (tab.kind === "chat" && isPendingConversationId(tab.id))
      delete detail.pendingConversationsById[tab.id];
  }
  const closing = (tab: SandboxWorkspaceTabIdentity | undefined) =>
    Boolean(tab && tabs.some((candidate) => sameWorkspaceTab(candidate, tab)));
  detail.openWorkspaceTabs = detail.openWorkspaceTabs.filter(
    (tab) => !closing(tab),
  );
  if (closing(detail.activeWorkspaceTab)) {
    const next =
      detail.openWorkspaceTabs.find((tab) => sameWorkspaceTab(tab, fallback)) ??
      detail.openWorkspaceTabs[0] ??
      undefined;
    detail.activeWorkspaceTab = next;
    if (next?.kind === "chat") selectWorkspaceTab(detail, next);
  }
}

export function workspaceTabsExcept(
  tabs: SandboxWorkspaceTabIdentity[],
  tab: SandboxWorkspaceTabIdentity,
): SandboxWorkspaceTabIdentity[] {
  return tabs.filter((candidate) => !sameWorkspaceTab(candidate, tab));
}

export function workspaceTabsLeftOf(
  tabs: SandboxWorkspaceTabIdentity[],
  tab: SandboxWorkspaceTabIdentity,
): SandboxWorkspaceTabIdentity[] {
  const index = tabs.findIndex((candidate) => sameWorkspaceTab(candidate, tab));
  return index <= 0 ? [] : tabs.slice(0, index);
}

export function workspaceTabsRightOf(
  tabs: SandboxWorkspaceTabIdentity[],
  tab: SandboxWorkspaceTabIdentity,
): SandboxWorkspaceTabIdentity[] {
  const index = tabs.findIndex((candidate) => sameWorkspaceTab(candidate, tab));
  return index < 0 ? [] : tabs.slice(index + 1);
}
