import Bot from "@lucide/svelte/icons/bot";
import CircleDot from "@lucide/svelte/icons/circle-dot";
import Code from "@lucide/svelte/icons/code";
import FileIcon from "@lucide/svelte/icons/file";
import FoldVertical from "@lucide/svelte/icons/fold-vertical";
import Folder from "@lucide/svelte/icons/folder";
import GitPullRequest from "@lucide/svelte/icons/git-pull-request";
import ListChecks from "@lucide/svelte/icons/list-checks";
import MessageSquarePlus from "@lucide/svelte/icons/message-square-plus";
import Play from "@lucide/svelte/icons/play";
import Slash from "@lucide/svelte/icons/slash";
import Sparkles from "@lucide/svelte/icons/sparkles";
import Square from "@lucide/svelte/icons/square";
import Wrench from "@lucide/svelte/icons/wrench";
import type { CompletionKind } from "@nervekit/contracts/completions";
import type { PopupRow } from "./composer-completion-model";

const kindIcons: Record<CompletionKind, typeof FileIcon> = {
  slash: Slash,
  file: FileIcon,
  directory: Folder,
  launch: Play,
  launch_definition: Play,
  pull_request: GitPullRequest,
  issue: CircleDot,
  skill: Sparkles,
  tool: Wrench,
  subagent_profile: Bot,
  subagent: Bot,
};

const commandIcons: Record<string, typeof FileIcon> = {
  plan: ListChecks,
  code: Code,
  compact: FoldVertical,
  abort: Square,
  new: MessageSquarePlus,
};

export function popupRowIcon(row: PopupRow): typeof FileIcon {
  if (row.command) return commandIcons[row.command] ?? Slash;
  return kindIcons[row.kind] ?? FileIcon;
}

export function popupRowIconClass(row: PopupRow): string {
  if (row.kind === "directory") return "text-info";
  if (row.kind === "file") return "text-success";
  return "text-muted-foreground";
}
