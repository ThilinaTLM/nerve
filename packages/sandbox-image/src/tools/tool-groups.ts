import type { SandboxConfigV1, ToolGroupStatus } from "@nervekit/shared";

const defaults: Record<string, string[]> = {
  fileInspection: ["read", "grep", "find", "ls"],
  fileEditing: ["edit", "write"],
  shell: ["bash"],
  python: ["python"],
  todos: ["todos_set", "todos_get"],
  web: ["web_search", "web_fetch"],
  explore: ["explore"],
  taskManagement: [
    "task_start",
    "task_status",
    "task_logs",
    "task_cancel",
    "task_restart",
    "task_list",
  ],
};
export function computeToolGroupStatus(
  config: SandboxConfigV1,
  runtime: { readOnly?: boolean; unavailable?: string[] } = {},
): ToolGroupStatus[] {
  const groups = config.tools?.groups ?? {};
  return Object.entries(defaults).map(([group, tools]) => {
    const configured = group in groups;
    const conf = (
      groups as Record<
        string,
        {
          enabled?: boolean;
          tools?: { enabled?: string[]; disabled?: string[] };
          credential?: { type: string };
        }
      >
    )[group];
    const active =
      conf?.enabled !== false &&
      (!runtime.readOnly ||
        group === "fileInspection" ||
        group === "explore") &&
      (config.agent.permissionLevel !== "read_only" ||
        group === "fileInspection" ||
        group === "explore");
    const enabled = conf?.tools?.enabled ?? tools;
    const disabled = new Set(conf?.tools?.disabled ?? []);
    return {
      group,
      configured,
      active,
      tools: enabled.filter(
        (tool) => !disabled.has(tool) && !runtime.unavailable?.includes(tool),
      ),
      unavailableTools: enabled.filter((tool) =>
        runtime.unavailable?.includes(tool),
      ),
      credentialType: conf?.credential?.type as
        | ToolGroupStatus["credentialType"]
        | undefined,
    };
  });
}
