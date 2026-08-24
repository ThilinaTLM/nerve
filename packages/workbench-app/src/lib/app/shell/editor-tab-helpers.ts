import { shortenPath } from "$lib/kernel/utils/path";
import { shortProjectLabel } from "$lib/kernel/utils/project-tree";
import type {
  CenterTabIdentity,
  CenterTabModel,
} from "$lib/application/workspace";

export type TabIdentity = CenterTabIdentity;

export function tabIdentity(tab: CenterTabModel): TabIdentity {
  if (tab.kind === "settings") return { kind: "settings", id: "settings" };
  if (tab.kind === "logs") return { kind: "logs", id: "logs" };
  if (tab.kind === "discover") return { kind: "discover", id: "discover" };
  return { kind: tab.kind, id: tab.id };
}

function taskLabel(tab: Extract<CenterTabModel, { kind: "task" }>): string {
  const labels = [tab.task?.displayName, tab.task?.name, tab.task?.command];
  return labels.find((label) => label?.trim())?.trim() ?? tab.id;
}

export function tabLabel(tab: CenterTabModel): string {
  if (tab.kind === "task") return taskLabel(tab);
  if (tab.kind === "file")
    return (
      tab.file?.name ??
      tab.relativePath?.split("/").pop() ??
      tab.path?.split("/").pop() ??
      "File"
    );
  if (tab.kind === "mermaid") {
    const diagramNumber = tab.locator ? tab.locator.ordinal + 1 : undefined;
    if (tab.origin === "inline")
      return `${tab.name ?? "Assistant diagram"}${diagramNumber ? ` ${diagramNumber}` : ""}`;
    const name =
      tab.name ??
      tab.relativePath?.split("/").pop() ??
      tab.path?.split("/").pop() ??
      "Markdown";
    return `${name} · diagram ${diagramNumber ?? ""}`.trim();
  }
  if (tab.kind === "pr") return `#${tab.number}`;
  if (tab.kind === "diff") {
    const name = tab.path?.split("/").pop() ?? "Diff";
    return tab.area === "staged" ? `${name} (staged)` : name;
  }
  if (tab.kind === "settings") return "Settings";
  if (tab.kind === "logs") return "Nerve Logs";
  if (tab.kind === "discover") return "Discover";
  if (tab.kind === "pending-conversation") return tab.title;
  return tab.conversation.title;
}

export function tabTitle(tab: CenterTabModel, homeDir?: string): string {
  if (tab.kind === "task") {
    if (!tab.task) return `Missing task · ${tab.id}`;
    return `${taskLabel(tab)} · ${tab.task.status} · ${shortenPath(tab.task.cwd, homeDir)} · ${tab.task.id}`;
  }
  if (tab.kind === "file") return tab.file?.path ?? tab.path ?? tab.id;
  if (tab.kind === "mermaid") {
    if (tab.origin === "inline")
      return `${tabLabel(tab)} · Mermaid diagram from assistant message`;
    return `${tab.path ?? tab.id} · Mermaid diagram${tab.locator ? ` at line ${tab.locator.startLine}` : ""}`;
  }
  if (tab.kind === "diff")
    return `${tab.path ?? tab.id} · ${tab.area === "staged" ? "staged" : "unstaged"} changes${tab.repo && tab.repo !== "." ? ` · ${tab.repo}` : ""}`;
  if (tab.kind === "pr")
    return tab.title
      ? `#${tab.number} ${tab.title}`
      : `Pull request #${tab.number}`;
  if (tab.kind === "settings") return "Workbench settings";
  if (tab.kind === "logs") return "Nerve application logs";
  if (tab.kind === "discover") return "Discover Nerve";
  const project = tab.project?.dir
    ? shortProjectLabel(tab.project.dir, homeDir)
    : tab.kind === "pending-conversation"
      ? shortProjectLabel(tab.projectDir, homeDir)
      : "Unknown project";
  if (tab.kind === "pending-conversation")
    return `${tab.title} · ${project} · created on first send`;
  return `${tab.conversation.title} · ${project} · ${tab.conversation.id}`;
}

export function statusLabel(tab: CenterTabModel): string | undefined {
  if (tab.error) return tab.error;
  if (tab.kind === "conversation" || tab.kind === "pending-conversation") {
    return tab.activity.label ?? (tab.hasDraft ? "Unsaved draft" : undefined);
  }
  if (tab.sending) {
    if (tab.kind === "task") return "Task active";
    if (tab.kind === "file") return "Loading file";
    if (tab.kind === "mermaid") return "Loading diagram";
    if (tab.kind === "diff") return "Loading diff";
  }
  if (tab.kind === "task") return tab.task?.status ?? "missing";
  if (tab.kind === "file" && tab.file?.truncated) return "Truncated";
  return undefined;
}

export function fileToggleLabel(tab: CenterTabModel): string {
  if (tab.kind !== "file") return "";
  return tab.displayMode === "rendered" ? "Show code" : "Show preview";
}

export function fileWrapLabel(tab: CenterTabModel): string {
  if (tab.kind !== "file") return "";
  return tab.wrapLines ? "Disable line wrap" : "Wrap long lines";
}

export function tabIndex(tabs: CenterTabModel[], tab: CenterTabModel): number {
  const identity = tabIdentity(tab);
  return tabs.findIndex((candidate) => {
    const candidateIdentity = tabIdentity(candidate);
    return (
      candidateIdentity.kind === identity.kind &&
      candidateIdentity.id === identity.id
    );
  });
}
