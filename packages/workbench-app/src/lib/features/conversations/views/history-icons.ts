import Bot from "@lucide/svelte/icons/bot";
import Brain from "@lucide/svelte/icons/brain";
import ClipboardCheck from "@lucide/svelte/icons/clipboard-check";
import ClipboardList from "@lucide/svelte/icons/clipboard-list";
import Cpu from "@lucide/svelte/icons/cpu";
import Download from "@lucide/svelte/icons/download";
import FilePen from "@lucide/svelte/icons/file-pen";
import FilePlus from "@lucide/svelte/icons/file-plus";
import FileText from "@lucide/svelte/icons/file-text";
import FoldVertical from "@lucide/svelte/icons/fold-vertical";
import FolderSearch from "@lucide/svelte/icons/folder-search";
import FolderTree from "@lucide/svelte/icons/folder-tree";
import GitBranch from "@lucide/svelte/icons/git-branch";
import Globe from "@lucide/svelte/icons/globe";
import Hand from "@lucide/svelte/icons/hand";
import Info from "@lucide/svelte/icons/info";
import ListTodo from "@lucide/svelte/icons/list-todo";
import MessageCircleQuestion from "@lucide/svelte/icons/message-circle-question";
import Search from "@lucide/svelte/icons/search";
import Sparkles from "@lucide/svelte/icons/sparkles";
import Terminal from "@lucide/svelte/icons/terminal";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import User from "@lucide/svelte/icons/user";
import Wrench from "@lucide/svelte/icons/wrench";
import type { Component } from "svelte";
import type { HistoryIconName, HistoryTone } from "./history-graph";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Lucide icon component interop.
type Icon = Component<any>;

export const HISTORY_ICONS: Record<HistoryIconName, Icon> = {
  user: User,
  sparkles: Sparkles,
  brain: Brain,
  wrench: Wrench,
  "file-text": FileText,
  terminal: Terminal,
  "file-pen": FilePen,
  "file-plus": FilePlus,
  search: Search,
  "folder-search": FolderSearch,
  "folder-tree": FolderTree,
  globe: Globe,
  download: Download,
  cpu: Cpu,
  bot: Bot,
  "message-circle-question": MessageCircleQuestion,
  "clipboard-list": ClipboardList,
  "clipboard-check": ClipboardCheck,
  "list-todo": ListTodo,
  "fold-vertical": FoldVertical,
  "git-branch": GitBranch,
  info: Info,
  hand: Hand,
  "triangle-alert": TriangleAlert,
};

export const HISTORY_TONE_TEXT: Record<HistoryTone, string> = {
  default: "text-muted-foreground",
  success: "text-success",
  warning: "text-warning",
  info: "text-info",
  danger: "text-destructive",
};
