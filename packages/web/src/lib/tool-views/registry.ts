import Bot from "@lucide/svelte/icons/bot";
import FilePen from "@lucide/svelte/icons/file-pen";
import FilePlus from "@lucide/svelte/icons/file-plus";
import FileText from "@lucide/svelte/icons/file-text";
import List from "@lucide/svelte/icons/list";
import MessageCircleQuestion from "@lucide/svelte/icons/message-circle-question";
import Play from "@lucide/svelte/icons/play";
import RotateCw from "@lucide/svelte/icons/rotate-cw";
import ScrollText from "@lucide/svelte/icons/scroll-text";
import Search from "@lucide/svelte/icons/search";
import Square from "@lucide/svelte/icons/square";
import Terminal from "@lucide/svelte/icons/terminal";
import Wrench from "@lucide/svelte/icons/wrench";
import type { Component } from "svelte";
import type { ToolCallRecord } from "../api";
import AskUserToolView from "../components/app/tool-call/AskUserToolView.svelte";
import BashToolView from "../components/app/tool-call/BashToolView.svelte";
import EditToolView from "../components/app/tool-call/EditToolView.svelte";
import FindToolView from "../components/app/tool-call/FindToolView.svelte";
import GenericToolView from "../components/app/tool-call/GenericToolView.svelte";
import GrepToolView from "../components/app/tool-call/GrepToolView.svelte";
import LsToolView from "../components/app/tool-call/LsToolView.svelte";
import ProcessListToolView from "../components/app/tool-call/ProcessListToolView.svelte";
import ProcessLogsToolView from "../components/app/tool-call/ProcessLogsToolView.svelte";
import ProcessToolView from "../components/app/tool-call/ProcessToolView.svelte";
import ReadToolView from "../components/app/tool-call/ReadToolView.svelte";
import SubagentRunToolView from "../components/app/tool-call/SubagentRunToolView.svelte";
import WriteToolView from "../components/app/tool-call/WriteToolView.svelte";
import type { ToolView } from "./tool-result-view";

type IconComponent = typeof Wrench;

const iconByTool: Record<string, IconComponent> = {
  read: FileText,
  bash: Terminal,
  edit: FilePen,
  write: FilePlus,
  grep: Search,
  find: Search,
  ls: List,
  ask_user: MessageCircleQuestion,
  process_start: Play,
  process_stop: Square,
  process_restart: RotateCw,
  process_list: List,
  process_logs: ScrollText,
  subagent_run: Bot,
};

export function toolIcon(toolName: ToolCallRecord["toolName"]): IconComponent {
  return iconByTool[toolName] ?? Wrench;
}

// biome-ignore lint/suspicious/noExplicitAny: per-tool view components accept their narrowed ToolView variant.
type ToolViewComponent = Component<any>;

const viewByKind: Record<ToolView["kind"], ToolViewComponent> = {
  read: ReadToolView,
  bash: BashToolView,
  edit: EditToolView,
  write: WriteToolView,
  grep: GrepToolView,
  find: FindToolView,
  ls: LsToolView,
  ask_user: AskUserToolView,
  process_action: ProcessToolView,
  process_list: ProcessListToolView,
  process_logs: ProcessLogsToolView,
  subagent_run: SubagentRunToolView,
  generic: GenericToolView,
};

export function toolViewComponent(kind: ToolView["kind"]): ToolViewComponent {
  return viewByKind[kind] ?? GenericToolView;
}
