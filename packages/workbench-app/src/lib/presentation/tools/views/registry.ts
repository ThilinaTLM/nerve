import type { Component } from "svelte";
import AskUserToolView from "../tool-call/AskUserToolView.svelte";
import BashToolView from "../tool-call/BashToolView.svelte";
import ConfluenceToolView from "../tool-call/ConfluenceToolView.svelte";
import EditToolView from "../tool-call/EditToolView.svelte";
import ExploreToolView from "../tool-call/ExploreToolView.svelte";
import ExplainImageToolView from "../tool-call/ExplainImageToolView.svelte";
import FindToolView from "../tool-call/FindToolView.svelte";
import GenericToolView from "../tool-call/GenericToolView.svelte";
import GrepToolView from "../tool-call/GrepToolView.svelte";
import JiraToolView from "../tool-call/JiraToolView.svelte";
import LsToolView from "../tool-call/LsToolView.svelte";
import PlanModeToolView from "../tool-call/PlanModeToolView.svelte";
import PythonToolView from "../tool-call/PythonToolView.svelte";
import ReadToolView from "../tool-call/ReadToolView.svelte";
import TaskStatusToolView from "../tool-call/TaskStatusToolView.svelte";
import TaskLogsToolView from "../tool-call/TaskLogsToolView.svelte";
import TaskToolView from "../tool-call/TaskToolView.svelte";
import TodoToolView from "../tool-call/TodoToolView.svelte";
import WebFetchToolView from "../tool-call/WebFetchToolView.svelte";
import WebSearchToolView from "../tool-call/WebSearchToolView.svelte";
import WriteToolView from "../tool-call/WriteToolView.svelte";
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
  explain_image: ExplainImageToolView,
  generic: GenericToolView,
};

export function toolViewComponent(kind: ToolView["kind"]): ToolViewComponent {
  return viewByKind[kind] ?? GenericToolView;
}
