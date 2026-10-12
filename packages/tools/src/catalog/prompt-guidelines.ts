import type { ToolGroupName, ToolName } from "@nervekit/contracts/tools";
import { toolDefinitionByName } from "./manifest.js";

const TOOL_GUIDELINES: Partial<Record<ToolName, string>> = {
  python_exec:
    'Write large Python outputs under os.environ["NERVE_PYTHON_ARTIFACT_DIR"]; do not pass secrets through env or use Python for long-lived or interactive processes.',
};

const GROUP_GUIDELINES: Partial<Record<ToolGroupName, string>> = {
  subagents:
    "Sub-agents run asynchronously and share your worktree. For parallel work, use one `subagent_prompt` batch with non-overlapping scopes and put shared background in `context`. Include paths, constraints and the expected outcome. Then continue independent work or end your turn; completion notices wake you. Use `subagent_status` only for long or suspicious work. Follow up by prompting the same name.",
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
  if (["bash", "async_bash", "launch"].some((name) => active.has(name))) {
    add(
      "Check launch status before starting a server; prefer launch definitions over bash for servers.",
    );
  }

  for (const name of activeToolNames) {
    const definition = toolDefinitionByName(name);
    if (!definition) continue;
    add(GROUP_GUIDELINES[definition.group]);
    add(TOOL_GUIDELINES[definition.name]);
  }

  return guidelines;
}
