import type { ToolName } from "@nervekit/shared";
import type { ToolExecutionContext, ToolExecutionResult } from "../types.js";
import {
  executeConfluenceCreatePage,
  executeConfluenceDownloadPages,
  executeConfluenceGetPage,
  executeConfluencePublishPages,
  executeConfluenceSearchPages,
  executeConfluenceSearchSpaces,
  executeConfluenceUpdatePage,
  executeConfluenceUploadAttachment,
} from "./confluence/confluence.js";
import { executeEdit } from "./filesystem/edit.js";
import { executeFind } from "./filesystem/find.js";
import { executeLs } from "./filesystem/list.js";
import { executeRead } from "./filesystem/read.js";
import { executeGrep } from "./filesystem/search.js";
import { executeWrite } from "./filesystem/write.js";
import {
  executeJiraAddComment,
  executeJiraCreateIssue,
  executeJiraGetIssue,
  executeJiraGetProject,
  executeJiraSearchIssues,
  executeJiraSearchUsers,
  executeJiraTransitionIssue,
  executeJiraUpdateIssue,
} from "./jira/jira.js";
import { executePython } from "./python/python.js";
import { executeBash } from "./shell/bash.js";
import { executeWebFetch } from "./web/web-fetch.js";
import { executeWebSearch } from "./web/web-search.js";

export async function executeTool(
  name: ToolName,
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  switch (name) {
    case "read":
      return executeRead(args, context);
    case "bash":
      return executeBash(args, context);
    case "python":
      return executePython(args, context);
    case "edit":
      return executeEdit(args, context);
    case "write":
      return executeWrite(args, context);
    case "grep":
      return executeGrep(args, context);
    case "find":
      return executeFind(args, context);
    case "ls":
      return executeLs(args, context);
    case "web_search":
      return executeWebSearch(args, context);
    case "web_fetch":
      return executeWebFetch(args, context);
    case "jira_search_users":
      return executeJiraSearchUsers(args, context);
    case "jira_search_issues":
      return executeJiraSearchIssues(args, context);
    case "jira_get_issue":
      return executeJiraGetIssue(args, context);
    case "jira_get_project":
      return executeJiraGetProject(args, context);
    case "jira_create_issue":
      return executeJiraCreateIssue(args, context);
    case "jira_update_issue":
      return executeJiraUpdateIssue(args, context);
    case "jira_add_comment":
      return executeJiraAddComment(args, context);
    case "jira_transition_issue":
      return executeJiraTransitionIssue(args, context);
    case "confluence_search_spaces":
      return executeConfluenceSearchSpaces(args, context);
    case "confluence_search_pages":
      return executeConfluenceSearchPages(args, context);
    case "confluence_get_page":
      return executeConfluenceGetPage(args, context);
    case "confluence_download_pages":
      return executeConfluenceDownloadPages(args, context);
    case "confluence_create_page":
      return executeConfluenceCreatePage(args, context);
    case "confluence_update_page":
      return executeConfluenceUpdatePage(args, context);
    case "confluence_publish_pages":
      return executeConfluencePublishPages(args, context);
    case "confluence_upload_attachment":
      return executeConfluenceUploadAttachment(args, context);
    case "ask_user":
      throw new Error(
        "ask_user is executed by the orchestrator user-interaction service.",
      );
    case "todos_set":
    case "todos_get":
      throw new Error(
        `${name} is executed by the orchestrator task-state service.`,
      );
    case "task_start":
    case "task_status":
    case "task_logs":
    case "task_cancel":
    case "task_restart":
    case "task_list":
      // packages/tools executes only core local tools. Background task tools are
      // orchestration tools: descriptors are shared for prompting/API purposes,
      // but execution is mediated by the orchestrator task manager.
      throw new Error(`${name} is executed by the orchestrator task manager.`);
    case "explore":
      // Explore agents require runtime/conversation authority checks owned by orchestrator.
      throw new Error(`${name} is executed by the orchestrator agent runtime.`);
    case "plan_mode_enter":
    case "plan_mode_present":
    case "plan_mode_force_exit":
      // Plan mode requires runtime/conversation state and user-review waiters owned by orchestrator.
      throw new Error(`${name} is executed by the orchestrator plan service.`);
  }
}
