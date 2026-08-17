import type { PrimaryArg } from "./tool-presentation-types";
import type { ToolView } from "./tool-view-types";

export function confluencePrimaryArg(
  view: Extract<ToolView, { kind: "confluence" }>,
): PrimaryArg | undefined {
  switch (view.action) {
    case "search_spaces":
      return view.query ? { text: view.query } : undefined;
    case "search_pages":
      return view.cql
        ? { text: view.cql }
        : view.query
          ? { text: view.query }
          : undefined;
    case "download_page":
      return view.page?.title
        ? { text: `${view.page.id} · ${view.page.title}` }
        : view.pageId
          ? { text: view.pageId }
          : undefined;
    case "manage_attachment": {
      const filename = view.filename ?? view.attachment?.filename;
      return filename
        ? { text: view.pageId ? `${filename} · ${view.pageId}` : filename }
        : view.pageId
          ? { text: view.pageId }
          : undefined;
    }
    case "manage_comment":
      return view.commentId
        ? {
            text: view.pageId
              ? `${view.commentId} · ${view.pageId}`
              : view.commentId,
          }
        : view.pageId
          ? { text: view.pageId }
          : undefined;
    case "manage_page":
      return view.page?.title
        ? { text: `${view.pageId ?? view.page.id} · ${view.page.title}` }
        : view.pageId
          ? { text: view.pageId }
          : undefined;
    case "manage_label":
      return view.pageId
        ? { text: view.label ? `${view.pageId} · ${view.label}` : view.pageId }
        : view.label
          ? { text: view.label }
          : undefined;
    case "manage_restriction":
      return view.pageId
        ? {
            text: view.restrictionOperation
              ? `${view.pageId} · ${view.restrictionOperation}`
              : view.pageId,
          }
        : undefined;
    case "get_page":
    case "create_page":
    case "update_page":
      return view.page?.title
        ? {
            text: view.page.id
              ? `${view.page.id} · ${view.page.title}`
              : view.page.title,
          }
        : view.pageId
          ? { text: view.pageId }
          : view.title
            ? { text: view.title }
            : undefined;
    default:
      return undefined;
  }
}

export function jiraPrimaryArg(
  view: Extract<ToolView, { kind: "jira" }>,
): PrimaryArg | undefined {
  switch (view.action) {
    case "search_users":
      return view.query ? { text: view.query } : undefined;
    case "search_issues":
      return view.jql ? { text: view.jql } : undefined;
    case "search_boards":
      return { text: view.query ?? "All visible boards" };
    case "get_board":
      return view.board
        ? {
            text: view.board.name
              ? `${view.board.id} · ${view.board.name}`
              : view.board.id,
          }
        : view.boardId
          ? { text: view.boardId }
          : undefined;
    case "get_sprint":
    case "manage_sprint":
      return view.sprint
        ? {
            text: view.sprint.name
              ? `${view.sprint.id} · ${view.sprint.name}`
              : view.sprint.id,
          }
        : view.sprintId
          ? { text: view.sprintId }
          : undefined;
    case "download_attachment":
      return view.filename
        ? { text: view.filename }
        : view.attachmentId
          ? { text: view.attachmentId }
          : undefined;
    case "manage_worklog":
    case "manage_backlog":
      return view.issueKey ? { text: view.issueKey } : undefined;
    case "manage_issue_link":
      return view.issueKey
        ? {
            text: view.otherIssueKey
              ? `${view.issueKey} ↔ ${view.otherIssueKey}`
              : view.linkId
                ? `${view.issueKey} · ${view.linkId}`
                : view.issueKey,
          }
        : undefined;
    case "manage_attachment":
      return view.operation === "delete"
        ? view.attachmentId
          ? { text: view.attachmentId }
          : undefined
        : view.filename
          ? {
              text: view.issueKey
                ? `${view.filename} · ${view.issueKey}`
                : view.filename,
            }
          : view.issueKey
            ? { text: view.issueKey }
            : undefined;
    case "get_project": {
      const label = view.project?.name
        ? `${view.project.key} · ${view.project.name}`
        : (view.projectKey ?? view.project?.key);
      return label ? { text: label } : undefined;
    }
    case "create_issue":
      return view.issueKey
        ? { text: view.issueKey }
        : view.summary
          ? {
              text: view.issueType
                ? `${view.issueType} · ${view.summary}`
                : view.summary,
            }
          : undefined;
    case "get_issue":
    case "update_issue":
    case "manage_comment":
    case "transition_issue":
      return view.issueKey ? { text: view.issueKey } : undefined;
    default:
      return undefined;
  }
}
