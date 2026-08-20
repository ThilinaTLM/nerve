export function summarizeExploreToolCall(
  toolName: string,
  args: Record<string, unknown>,
): string {
  switch (toolName) {
    case "read":
      return activity("Reading file", pathDetail(args) + rangeSuffix(args));
    case "grep":
      return activity(
        "Searching codebase",
        `${quoteValue(args.pattern)}${pathSuffix(args)}`,
      );
    case "find":
      return activity(
        "Finding files",
        `${quoteValue(args.pattern)}${pathSuffix(args)}`,
      );
    case "ls":
      return activity("Listing directory", pathDetail(args));
    case "edit":
      return activity("Editing file", pathDetail(args));
    case "write":
      return activity("Writing file", pathDetail(args));
    case "bash":
      return "Running shell command";
    case "python_exec":
      return stringValue(args.path)
        ? activity("Running Python script", stringValue(args.path))
        : "Running Python code";
    case "web_search":
      return activity("Searching the web", stringValue(args.query));
    case "web_fetch":
      return activity("Fetching web page", safeUrl(args.url));
    case "explain_image":
      return activity("Explaining image", pathDetail(args));
    case "ask_user":
      return "Requesting user input";
    case "todos_set":
      return "Updating task list";
    case "todos_get":
      return "Reading task list";
    case "task_start":
      return activity("Starting background task", stringValue(args.name));
    case "task_status":
      return activity("Checking background tasks", taskStatusScopeLabel(args));
    case "task_logs":
      return activity(
        "Reading task logs",
        `${taskScopeLabel(args)}${modeSuffix(args)}`,
      );
    case "task_control":
      return activity(
        args.action === "restart"
          ? "Restarting background task"
          : "Stopping background task",
        taskScopeLabel(args),
      );
    case "jira_search_users":
      return activity(
        "Searching Jira users",
        firstString(args, "query", "username", "displayName"),
      );
    case "jira_search_issues":
      return activity("Searching Jira issues", stringValue(args.jql));
    case "jira_get_issue":
      return activity("Reading Jira issue", issueDetail(args));
    case "jira_get_project":
      return activity("Reading Jira project", projectDetail(args));
    case "jira_search_boards":
      return activity(
        "Searching Jira boards",
        firstString(args, "project_key", "name"),
      );
    case "jira_get_board":
      return activity("Reading Jira board", stringValue(args.board_id));
    case "jira_get_sprint":
      return activity("Reading Jira sprint", stringValue(args.sprint_id));
    case "jira_download_attachment":
      return activity(
        "Downloading Jira attachment",
        stringValue(args.attachment_id),
      );
    case "jira_create_issue":
      return activity("Creating Jira issue", projectDetail(args));
    case "jira_update_issue":
      return activity("Updating Jira issue", issueDetail(args));
    case "jira_manage_comment":
      return activity("Managing Jira comment", issueDetail(args));
    case "jira_manage_worklog":
      return activity("Managing Jira worklog", issueDetail(args));
    case "jira_manage_issue_link":
      return activity("Managing Jira issue link", issueDetail(args));
    case "jira_manage_attachment":
      return activity(
        "Managing Jira attachment",
        firstString(args, "file_path", "attachment_id", "issue_key"),
      );
    case "jira_manage_sprint":
      return activity(
        "Managing Jira sprint",
        firstString(args, "sprint_id", "name"),
      );
    case "jira_manage_backlog":
      return activity("Managing Jira backlog", issueDetail(args));
    case "jira_transition_issue":
      return activity("Transitioning Jira issue", issueDetail(args));
    case "confluence_search_spaces":
      return activity(
        "Searching Confluence spaces",
        firstString(args, "query", "space_key", "spaceKey", "key"),
      );
    case "confluence_search_pages":
      return activity(
        "Searching Confluence pages",
        firstString(args, "cql", "query", "title", "space_key"),
      );
    case "confluence_get_page":
      return activity("Reading Confluence page", pageDetail(args));
    case "confluence_download_page":
      return activity("Downloading Confluence page", stringValue(args.page_id));
    case "confluence_create_page":
      return activity(
        "Creating Confluence page",
        firstString(args, "title", "space_key"),
      );
    case "confluence_update_page":
      return activity("Updating Confluence page", pageDetail(args));
    case "confluence_manage_comment":
      return activity("Managing Confluence comment", pageDetail(args));
    case "confluence_manage_page":
      return activity("Managing Confluence page", pageDetail(args));
    case "confluence_manage_label":
      return activity("Managing Confluence label", pageDetail(args));
    case "confluence_manage_restriction":
      return activity("Managing Confluence restriction", pageDetail(args));
    case "confluence_manage_attachment":
      return activity(
        "Managing Confluence attachment",
        firstString(args, "file_path", "attachment_id", "page_id"),
      );
    case "explore":
      return "Exploring the codebase";
    case "plan_mode_enter":
      return "Entering plan mode";
    case "plan_mode_present":
      return "Presenting implementation plan";
    case "plan_mode_force_exit":
      return "Leaving plan mode";
    default:
      return `Running ${humanizeToolName(toolName)}`;
  }
}

function activity(label: string, detail?: string): string {
  const bounded = detail ? truncateInline(detail, 120) : undefined;
  return bounded ? `${label} (${bounded})` : label;
}

function firstString(
  args: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = stringValue(args[key]);
    if (value) return value;
  }
  return undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function pathDetail(args: Record<string, unknown>): string {
  return truncateInline(stringValue(args.path) ?? ".", 100);
}

function issueDetail(args: Record<string, unknown>): string | undefined {
  return firstString(
    args,
    "issue_key",
    "issueIdOrKey",
    "issueKey",
    "key",
    "id",
  );
}

function projectDetail(args: Record<string, unknown>): string | undefined {
  return firstString(
    args,
    "project_key",
    "projectIdOrKey",
    "projectKey",
    "key",
    "id",
  );
}

function pageDetail(args: Record<string, unknown>): string | undefined {
  return firstString(args, "page_id", "pageId", "id", "title");
}

function safeUrl(value: unknown): string | undefined {
  const text = stringValue(value);
  if (!text) return undefined;
  try {
    const url = new URL(text);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return text.split(/[?#]/, 1)[0];
  }
}

function humanizeToolName(toolName: string): string {
  const readable = toolName.replace(/[_-]+/g, " ").trim();
  return truncateInline(readable || "tool", 80);
}

function quoteValue(value: unknown): string {
  const text = stringValue(value);
  return text ? JSON.stringify(truncateInline(text, 80)) : "pattern";
}

function pathSuffix(args: Record<string, unknown>): string {
  const path = stringValue(args.path);
  const paths = Array.isArray(args.paths)
    ? args.paths.filter((value) => typeof value === "string")
    : [];
  if (path) return ` in ${truncateInline(path, 100)}`;
  if (paths.length > 0) return ` in ${paths.length} paths`;
  return " in .";
}

function rangeSuffix(args: Record<string, unknown>): string {
  const offset = typeof args.offset === "number" ? args.offset : undefined;
  const limit = typeof args.limit === "number" ? args.limit : undefined;
  if (offset === undefined && limit === undefined) return "";
  return ` · line ${offset ?? 1}${limit ? ` · ${limit} lines` : ""}`;
}

function modeSuffix(args: Record<string, unknown>): string {
  const mode = stringValue(args.mode);
  return mode ? ` · ${mode}` : "";
}

function taskScopeLabel(args: Record<string, unknown>): string {
  const taskId = stringValue(args.taskId);
  if (taskId) return taskId;
  const taskIds = Array.isArray(args.taskIds)
    ? args.taskIds.filter((value) => typeof value === "string")
    : [];
  if (taskIds.length > 0) {
    return `${taskIds.length} task${taskIds.length === 1 ? "" : "s"}`;
  }
  const groupId = stringValue(args.groupId);
  if (groupId) return `group ${groupId}`;
  const name = stringValue(args.name);
  if (name) return name;
  return "current";
}

function taskStatusScopeLabel(args: Record<string, unknown>): string {
  const scope = taskScopeLabel(args);
  const hasSelector =
    Boolean(stringValue(args.taskId)) ||
    Array.isArray(args.taskIds) ||
    Boolean(stringValue(args.groupId));
  const status = stringValue(args.status) ?? (hasSelector ? "all" : "active");
  return `${scope} · ${status}`;
}

function truncateInline(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 1)}…`;
}
