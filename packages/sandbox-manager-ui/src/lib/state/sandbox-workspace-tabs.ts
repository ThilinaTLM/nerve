import { notify } from "@nervekit/ui/core/notify";
import { defaultFileDisplayMode } from "@nervekit/ui/core/utils/file-display";
import * as api from "../api/manager-client";
import type {
  SandboxDetailState,
  SandboxWorkspaceFileViewState,
  SandboxWorkspaceTabIdentity,
} from "./sandbox-ui-types";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sameWorkspaceTab(
  a: SandboxWorkspaceTabIdentity | undefined,
  b: SandboxWorkspaceTabIdentity,
): boolean {
  return a?.kind === b.kind && a.id === b.id;
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
}

export function closeWorkspaceTab(
  detail: SandboxDetailState,
  tab: SandboxWorkspaceTabIdentity,
): void {
  if (tab.kind === "chat") return;
  const index = detail.openWorkspaceTabs.findIndex((open) =>
    sameWorkspaceTab(open, tab),
  );
  detail.openWorkspaceTabs = detail.openWorkspaceTabs.filter(
    (open) => !sameWorkspaceTab(open, tab),
  );
  delete detail.workspaceFileViewsById[tab.id];
  if (sameWorkspaceTab(detail.activeWorkspaceTab, tab)) {
    detail.activeWorkspaceTab =
      detail.openWorkspaceTabs[Math.max(0, index - 1)] ??
      ({ kind: "chat", id: "chat" } as const);
  }
}

export function openWorkspaceChatTab(detail: SandboxDetailState): void {
  selectWorkspaceTab(detail, { kind: "chat", id: "chat" });
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
