import type { ToolExecutionContext, ToolExecutionResult } from "../../types.js";
import { jiraRequest, requireJiraConnection } from "./client.js";
import {
  buildJiraTextResult,
  displayLimitNotice,
  formatBoardSummaryLine,
  maybeWriteJiraArtifact,
  summarizeJiraBoard,
  takeDisplayItems,
} from "./format.js";
import { boundedNumber, optionalString } from "./helpers.js";

export async function executeJiraSearchBoards(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const connection = await requireJiraConnection(context);
  const data = await jiraRequest<Record<string, unknown>>(connection, {
    api: "agile",
    path: "/board",
    query: {
      projectKeyOrId: optionalString(args.project_key),
      name: optionalString(args.name),
      type: optionalString(args.board_type),
      startAt: boundedNumber(args.start_at, 0, 0, 100000),
      maxResults: boundedNumber(args.limit, 25, 1, 100),
    },
    signal: context.signal,
  });
  const boards = Array.isArray(data.values) ? data.values : [];
  const boardSummaries = boards.flatMap((value) => {
    const summary = summarizeJiraBoard(value);
    return summary ? [summary] : [];
  });
  const artifact = await maybeWriteJiraArtifact(
    context,
    "search-boards",
    data,
    args.save_to_file,
  );
  const displayedBoards = takeDisplayItems(boardSummaries);
  const lines = [
    `Jira board search returned ${boards.length} board${boards.length === 1 ? "" : "s"}.`,
  ];
  const notice = displayLimitNotice({
    noun: "board",
    total: boardSummaries.length,
    displayed: displayedBoards.displayed,
    artifactPath: artifact?.path,
  });
  if (notice) lines.push(notice);
  if (artifact) lines.push(`Raw JSON saved to: ${artifact.path}`);
  if (displayedBoards.items.length > 0) {
    lines.push("", ...displayedBoards.items.map(formatBoardSummaryLine));
  }
  return buildJiraTextResult({
    text: lines.join("\n").trimEnd(),
    context,
    artifact,
    details: {
      action: "search_boards",
      boards: displayedBoards.items,
      boardCount: boards.length,
      displayedBoardCount: displayedBoards.displayed,
      startAt: data.startAt,
      maxResults: data.maxResults,
      total: data.total,
      isLast: data.isLast,
    },
  });
}
