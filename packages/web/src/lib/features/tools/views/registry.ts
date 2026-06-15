import type { Component } from "svelte";
import AskUserToolView from "$lib/features/tools/components/tool-call/AskUserToolView.svelte";
import BashToolView from "$lib/features/tools/components/tool-call/BashToolView.svelte";
import EditToolView from "$lib/features/tools/components/tool-call/EditToolView.svelte";
import ExploreToolView from "$lib/features/tools/components/tool-call/ExploreToolView.svelte";
import FindToolView from "$lib/features/tools/components/tool-call/FindToolView.svelte";
import GenericToolView from "$lib/features/tools/components/tool-call/GenericToolView.svelte";
import GrepToolView from "$lib/features/tools/components/tool-call/GrepToolView.svelte";
import LsToolView from "$lib/features/tools/components/tool-call/LsToolView.svelte";
import PlanModeToolView from "$lib/features/tools/components/tool-call/PlanModeToolView.svelte";
import ProcessListToolView from "$lib/features/tools/components/tool-call/ProcessListToolView.svelte";
import ProcessLogsToolView from "$lib/features/tools/components/tool-call/ProcessLogsToolView.svelte";
import ProcessToolView from "$lib/features/tools/components/tool-call/ProcessToolView.svelte";
import PythonToolView from "$lib/features/tools/components/tool-call/PythonToolView.svelte";
import ReadToolView from "$lib/features/tools/components/tool-call/ReadToolView.svelte";
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
  process_action: ProcessToolView,
  process_list: ProcessListToolView,
  process_logs: ProcessLogsToolView,
  explore: ExploreToolView,
  plan_mode: PlanModeToolView,
  web_search: WebSearchToolView,
  web_fetch: WebFetchToolView,
  generic: GenericToolView,
};

export function toolViewComponent(kind: ToolView["kind"]): ToolViewComponent {
  return viewByKind[kind] ?? GenericToolView;
}
