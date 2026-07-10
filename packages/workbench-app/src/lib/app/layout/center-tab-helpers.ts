import { shortenPath } from "$lib/core/utils/path";
import { shortProjectLabel } from "$lib/core/utils/project-tree";
import type {
  CenterTabIdentity,
  CenterTabModel,
} from "$lib/features/workspace";

export type TabIdentity = CenterTabIdentity;

export function tabIdentity(tab: CenterTabModel): TabIdentity {
  if (tab.kind === "settings") return { kind: "settings", id: "settings" };
  if (tab.kind === "auth") return { kind: "auth", id: "auth" };
  if (tab.kind === "logs") return { kind: "logs", id: "logs" };
  return { kind: tab.kind, id: tab.id };
}

export function tabLabel(tab: CenterTabModel): string {
  if (tab.kind === "task") return tab.task?.name ?? tab.task?.command ?? tab.id;
  if (tab.kind === "file")
    return (
      tab.file?.name ??
      tab.relativePath?.split("/").pop() ??
      tab.path?.split("/").pop() ??
      "File"
    );
  if (tab.kind === "pr") return `#${tab.number}`;
  if (tab.kind === "settings") return "Settings";
  if (tab.kind === "auth") return "Authentication";
  if (tab.kind === "logs") return "Nerve Logs";
  if (tab.kind === "pending-conversation") return tab.title;
  return tab.conversation.title;
}

export function tabTitle(tab: CenterTabModel, homeDir?: string): string {
  if (tab.kind === "task") {
    if (!tab.task) return `Missing task · ${tab.id}`;
    return `${tab.task.name ?? tab.task.command} · ${tab.task.status} · ${shortenPath(tab.task.cwd, homeDir)} · ${tab.task.id}`;
  }
  if (tab.kind === "file") return tab.file?.path ?? tab.path ?? tab.id;
  if (tab.kind === "pr")
    return tab.title
      ? `#${tab.number} ${tab.title}`
      : `Pull request #${tab.number}`;
  if (tab.kind === "settings") return "Workbench settings";
  if (tab.kind === "auth") return "Providers & authentication";
  if (tab.kind === "logs") return "Nerve application logs";
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
  }
  if (tab.kind === "task") return tab.task?.status ?? "missing";
  if (tab.kind === "file" && tab.file?.truncated) return "Truncated";
  return undefined;
}

export function fileToggleLabel(tab: CenterTabModel): string {
  if (tab.kind !== "file") return "";
  return tab.displayMode === "rendered"
    ? "Show raw markdown"
    : "Show rendered markdown";
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
