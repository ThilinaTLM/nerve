import type { Component } from "svelte";
import AskUserToolView from "../components/tool-call/AskUserToolView.svelte";
import BashToolView from "../components/tool-call/BashToolView.svelte";
import ConfluenceToolView from "../components/tool-call/ConfluenceToolView.svelte";
import EditToolView from "../components/tool-call/EditToolView.svelte";
import ExploreToolView from "../components/tool-call/ExploreToolView.svelte";
import FindToolView from "../components/tool-call/FindToolView.svelte";
import GenericToolView from "../components/tool-call/GenericToolView.svelte";
import GrepToolView from "../components/tool-call/GrepToolView.svelte";
import JiraToolView from "../components/tool-call/JiraToolView.svelte";
import LsToolView from "../components/tool-call/LsToolView.svelte";
import PlanModeToolView from "../components/tool-call/PlanModeToolView.svelte";
import PythonToolView from "../components/tool-call/PythonToolView.svelte";
import ReadToolView from "../components/tool-call/ReadToolView.svelte";
import TaskStatusToolView from "../components/tool-call/TaskStatusToolView.svelte";
import TaskLogsToolView from "../components/tool-call/TaskLogsToolView.svelte";
import TaskToolView from "../components/tool-call/TaskToolView.svelte";
import TodoToolView from "../components/tool-call/TodoToolView.svelte";
import WebFetchToolView from "../components/tool-call/WebFetchToolView.svelte";
import WebSearchToolView from "../components/tool-call/WebSearchToolView.svelte";
import WriteToolView from "../components/tool-call/WriteToolView.svelte";
import type { ToolView } from "./tool-result-view";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Per-tool view components accept their narrowed ToolView variant.
type ToolViewComponent = Component<any>;

const viewByKind: Record<ToolView["kind"], ToolViewComponent> = {
  read: ReadToolView,
  bash: BashToolView,
  python: PythonToolView,
  edit: EditToolView,
  write: WriteToolView,
  grep: GrepToolView,
  find: FindToolView,
  ls: LsToolView,
  ask_user: AskUserToolView,
  todos: TodoToolView,
  task_action: TaskToolView,
  task_status: TaskStatusToolView,
  task_logs: TaskLogsToolView,
  explore: ExploreToolView,
  plan_mode: PlanModeToolView,
  jira: JiraToolView,
  confluence: ConfluenceToolView,
  web_search: WebSearchToolView,
  web_fetch: WebFetchToolView,
  generic: GenericToolView,
};

export function toolViewComponent(kind: ToolView["kind"]): ToolViewComponent {
  return viewByKind[kind] ?? GenericToolView;
}
