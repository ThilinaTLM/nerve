import type { Component } from "svelte";
import QuickScriptToolView from "../tool-call/QuickScriptToolView.svelte";
import AskUserToolView from "../tool-call/AskUserToolView.svelte";
import BashToolView from "../tool-call/BashToolView.svelte";
import EditToolView from "../tool-call/EditToolView.svelte";
import ExplainImageToolView from "../tool-call/ExplainImageToolView.svelte";
import FindToolView from "../tool-call/FindToolView.svelte";
import GenericToolView from "../tool-call/GenericToolView.svelte";
import GrepToolView from "../tool-call/GrepToolView.svelte";
import LsToolView from "../tool-call/LsToolView.svelte";
import PlanPresentToolView from "../tool-call/PlanPresentToolView.svelte";
import PythonToolView from "../tool-call/PythonToolView.svelte";
import ReadToolView from "../tool-call/ReadToolView.svelte";
import SubagentToolView from "../tool-call/SubagentToolView.svelte";
import TodoToolView from "../tool-call/TodoToolView.svelte";
import WebFetchToolView from "../tool-call/WebFetchToolView.svelte";
import ExtensionToolView from "../tool-call/ExtensionToolView.svelte";
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
  subagent: SubagentToolView,
  plan_present: PlanPresentToolView,
  extension: ExtensionToolView,
  web_fetch: WebFetchToolView,
  explain_image: ExplainImageToolView,
  quick_script: QuickScriptToolView,
  generic: GenericToolView,
};

export function toolViewComponent(kind: ToolView["kind"]): ToolViewComponent {
  return viewByKind[kind] ?? GenericToolView;
}
