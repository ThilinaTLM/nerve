import type { Sandbox } from "./atlassian.ts";
import type { ApprovalScope } from "./types.ts";

export interface ApprovalRequestView {
  readonly toolName: string;
  readonly arguments: unknown;
  /** Approval reason and suggested rules as the daemon reports them. */
  readonly request?: unknown;
}

export interface ApprovalDecision {
  readonly decision: "approve" | "deny";
  readonly reason: string;
}

const SHELL_TOOLS = new Set([
  "bash",
  "python_exec",
  "async_bash",
  "write",
  "edit",
]);
const ALWAYS_DENIED = new Set(["launch", "subagent_prompt", "web_fetch"]);

/**
 * Approve inside the task's declared scope, deny otherwise. The decision looks
 * at the tool name, its arguments and the daemon's approval reason:
 * Jira keys must belong to the sandbox project (and the task's own fixtures
 * when listed), Confluence space keys to the sandbox space, deletes and shell
 * access only when the task declares them.
 */
export function decideApproval(
  view: ApprovalRequestView,
  scope: ApprovalScope,
  sandbox: Sandbox,
): ApprovalDecision {
  const deny = (reason: string): ApprovalDecision => ({
    decision: "deny",
    reason,
  });
  if (ALWAYS_DENIED.has(view.toolName))
    return deny(`${view.toolName} is never in scope`);
  if (SHELL_TOOLS.has(view.toolName) && !scope.allowShell)
    return deny(`${view.toolName} is outside this task's scope`);

  const text = JSON.stringify([view.arguments, view.request ?? null]);

  for (const key of text.match(/\b[A-Z][A-Z0-9]{1,9}-\d+\b/g) ?? []) {
    const project = key.slice(0, key.lastIndexOf("-"));
    if (project !== sandbox.jiraProject)
      return deny(`issue ${key} is outside project ${sandbox.jiraProject}`);
    if (scope.issueKeys && !scope.issueKeys.includes(key))
      return deny(`issue ${key} is not a fixture of this task`);
  }
  for (const match of text.matchAll(
    /\\?"(?:projectKey|project)\\?"\s*:\s*\\?"([A-Za-z0-9_]+)\\?"/g,
  ))
    if (match[1] !== sandbox.jiraProject)
      return deny(`project ${match[1]} is outside ${sandbox.jiraProject}`);
  for (const match of text.matchAll(
    /\\?"(?:spaceKey|space)\\?"\s*:\s*\\?"([A-Za-z0-9~_-]+)\\?"/g,
  ))
    if (match[1] !== sandbox.confluenceSpace)
      return deny(`space ${match[1]} is outside ${sandbox.confluenceSpace}`);
  if (scope.pageIds)
    for (const match of text.matchAll(
      /\\?"(?:pageId|page_id|id)\\?"\s*:\s*\\?"?(\d{4,})\\?"?/g,
    ))
      if (!scope.pageIds.includes(match[1]!))
        return deny(`page ${match[1]} is not a fixture of this task`);

  const deleting =
    /(?:^|_)(?:delete|purge)(?:$|_)/.test(view.toolName) ||
    /\.(?:delete|purge)\s*\(|\\?"(?:action|operation)\\?"\s*:\s*\\?"(?:delete|purge)\\?"/.test(
      text,
    );
  if (deleting && !scope.allowDelete) return deny("delete is outside scope");
  return { decision: "approve", reason: "inside the declared scope" };
}
