import type { Component } from "svelte";
import AskUserToolView from "$lib/features/tools/components/tool-call/AskUserToolView.svelte";
import BashToolView from "$lib/features/tools/components/tool-call/BashToolView.svelte";
import ConfluenceToolView from "$lib/features/tools/components/tool-call/ConfluenceToolView.svelte";
import EditToolView from "$lib/features/tools/components/tool-call/EditToolView.svelte";
import ExploreToolView from "$lib/features/tools/components/tool-call/ExploreToolView.svelte";
import FindToolView from "$lib/features/tools/components/tool-call/FindToolView.svelte";
import GenericToolView from "$lib/features/tools/components/tool-call/GenericToolView.svelte";
import GrepToolView from "$lib/features/tools/components/tool-call/GrepToolView.svelte";
import JiraToolView from "$lib/features/tools/components/tool-call/JiraToolView.svelte";
import LsToolView from "$lib/features/tools/components/tool-call/LsToolView.svelte";
import PlanModeToolView from "$lib/features/tools/components/tool-call/PlanModeToolView.svelte";
import PythonToolView from "$lib/features/tools/components/tool-call/PythonToolView.svelte";
import ReadToolView from "$lib/features/tools/components/tool-call/ReadToolView.svelte";
import TaskListToolView from "$lib/features/tools/components/tool-call/TaskListToolView.svelte";
import TaskLogsToolView from "$lib/features/tools/components/tool-call/TaskLogsToolView.svelte";
import TaskToolView from "$lib/features/tools/components/tool-call/TaskToolView.svelte";
import TodoToolView from "$lib/features/tools/components/tool-call/TodoToolView.svelte";
import WebFetchToolView from "$lib/features/tools/components/tool-call/WebFetchToolView.svelte";
import WebSearchToolView from "$lib/features/tools/components/tool-call/WebSearchToolView.svelte";
import WriteToolView from "$lib/features/tools/components/tool-call/WriteToolView.svelte";
import type { ToolView } from "./tool-result-view";

// biome-ignore lint/suspicious/noExplicitAny: per-tool view components accept their narrowed ToolView variant.
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
  task_list: TaskListToolView,
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
