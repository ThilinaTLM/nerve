import type { ToolGroupName, ToolName } from "@nervekit/contracts/tools";
import { toolDefinitionByName } from "./manifest.js";

const TOOL_GUIDELINES: Partial<Record<ToolName, string>> = {
  python_exec:
    'Write large Python outputs under os.environ["NERVE_PYTHON_ARTIFACT_DIR"]; do not pass secrets through env or use Python for long-lived or interactive processes.',
  task_start:
    "Before starting a server or watcher, inspect active tasks with task_status unless current task state is already known; after launch, rely on asynchronous updates instead of polling task_status or task_logs.",
};

const GROUP_GUIDELINES: Partial<Record<ToolGroupName, string>> = {
  jira: "Keep Jira queries narrow and mutate Jira only when explicitly requested.",
  confluence:
    "Use storage XML or JSONL as the editable Confluence source of truth, treat markdown as read-only, and mutate Confluence only when explicitly requested.",
};

export function promptGuidelinesForTools(
  activeToolNames: readonly string[],
): string[] {
  const active = new Set(activeToolNames);
  const guidelines: string[] = [];
  const seen = new Set<string>();
  const add = (guideline: string | undefined) => {
    const normalized = guideline?.trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    guidelines.push(normalized);
  };

  if (
    active.has("bash") &&
    ["read", "grep", "find", "ls"].some((name) => active.has(name))
  ) {
    add("Prefer dedicated file tools over bash for inspection and search.");
  }

  for (const name of activeToolNames) {
    const definition = toolDefinitionByName(name);
    if (!definition) continue;
    add(GROUP_GUIDELINES[definition.group]);
    add(TOOL_GUIDELINES[definition.name]);
  }

  return guidelines;
}
