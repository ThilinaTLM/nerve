import type { Component } from "svelte";
import AskUserToolView from "../components/app/tool-call/AskUserToolView.svelte";
import BashToolView from "../components/app/tool-call/BashToolView.svelte";
import EditToolView from "../components/app/tool-call/EditToolView.svelte";
import FindToolView from "../components/app/tool-call/FindToolView.svelte";
import GenericToolView from "../components/app/tool-call/GenericToolView.svelte";
import GrepToolView from "../components/app/tool-call/GrepToolView.svelte";
import LsToolView from "../components/app/tool-call/LsToolView.svelte";
import PlanModeToolView from "../components/app/tool-call/PlanModeToolView.svelte";
import ProcessListToolView from "../components/app/tool-call/ProcessListToolView.svelte";
import ProcessLogsToolView from "../components/app/tool-call/ProcessLogsToolView.svelte";
import ProcessToolView from "../components/app/tool-call/ProcessToolView.svelte";
import ReadToolView from "../components/app/tool-call/ReadToolView.svelte";
import SubagentRunToolView from "../components/app/tool-call/SubagentRunToolView.svelte";
import TodoToolView from "../components/app/tool-call/TodoToolView.svelte";
import WebFetchToolView from "../components/app/tool-call/WebFetchToolView.svelte";
import WebSearchToolView from "../components/app/tool-call/WebSearchToolView.svelte";
import WriteToolView from "../components/app/tool-call/WriteToolView.svelte";
import type { ToolView } from "./tool-result-view";

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
  todos: TodoToolView,
  process_action: ProcessToolView,
  process_list: ProcessListToolView,
  process_logs: ProcessLogsToolView,
  subagent_run: SubagentRunToolView,
  plan_mode: PlanModeToolView,
  web_search: WebSearchToolView,
  web_fetch: WebFetchToolView,
  generic: GenericToolView,
};

export function toolViewComponent(kind: ToolView["kind"]): ToolViewComponent {
  return viewByKind[kind] ?? GenericToolView;
}
