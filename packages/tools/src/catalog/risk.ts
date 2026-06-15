import type { ToolName, ToolRisk } from "@nerve/shared";

const toolRisks: Record<ToolName, ToolRisk> = {
  read: "read",
  bash: "command",
  python: "command",
  edit: "workspace_write",
  write: "workspace_write",
  grep: "read",
  find: "read",
  ls: "read",
  ask_user: "interaction",
  todos_set: "interaction",
  todos_get: "read",
  web_search: "network",
  web_fetch: "network",
  process_start: "command",
  process_stop: "destructive",
  process_restart: "destructive",
  process_list: "read",
  process_logs: "read",
  explore: "agent_spawn",
  plan_mode_enter: "interaction",
  plan_mode_present: "interaction",
  plan_mode_force_exit: "interaction",
};

export function coreToolRiskForName(name: ToolName): ToolRisk {
  return toolRisks[name] ?? "command";
}
