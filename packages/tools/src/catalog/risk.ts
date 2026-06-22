import type { ToolName, ToolRisk } from "@nerve/shared";

const toolRisks: Record<ToolName, ToolRisk> = {
  read: "read",
  bash: "command",
  python: "command",
  edit: "workspace_write",
  legacy_edit: "workspace_write",
  write: "workspace_write",
  grep: "read",
  find: "read",
  ls: "read",
  ask_user: "interaction",
  todos_set: "interaction",
  todos_get: "read",
  web_search: "network",
  web_fetch: "network",
  task_start: "command",
  task_status: "read",
  task_logs: "read",
  task_cancel: "command",
  task_restart: "command",
  task_list: "read",
  explore: "agent_spawn",
  plan_mode_enter: "interaction",
  plan_mode_present: "interaction",
  plan_mode_force_exit: "interaction",
};

export function coreToolRiskForName(name: ToolName): ToolRisk {
  return toolRisks[name] ?? "command";
}
