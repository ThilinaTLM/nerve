import type { ToolExecutionContext, ToolExecutionResult } from "../../types.js";
import { requireJiraConnection } from "./client.js";
import {
  buildJiraTextResult,
  displayLimitNotice,
  formatUserSummaryLine,
  summarizeJiraUser,
  takeDisplayItems,
  writeJiraArtifact,
} from "./format.js";
import {
  boundedNumber,
  jiraUsersFromResponse,
  optionalString,
  requiredString,
  searchJiraUsers,
} from "./helpers.js";

export async function executeJiraSearchUsers(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const connection = await requireJiraConnection(context);
  const query = requiredString(args.query, "query");
  const maxResults = boundedNumber(args.max_results, 10, 1, 50);
  const projectKey =
    optionalString(args.project_key) ?? connection.defaultProjectKey;
  const issueKey = optionalString(args.issue_key);
  const includeInactive = args.include_inactive === true;
  const data = await searchJiraUsers(connection, {
    query,
    projectKey,
    issueKey,
    maxResults,
    includeInactive,
    signal: context.signal,
  });
  const artifact =
    args.save_to_file === false
      ? undefined
      : await writeJiraArtifact(context, "search-users", data);
  const rawUsers = jiraUsersFromResponse(data);
  const users = rawUsers.flatMap((user) => {
    const summary = summarizeJiraUser(user);
    return summary ? [summary] : [];
  });
  const displayed = takeDisplayItems(users);
  const lines = [
    `Jira user search returned ${rawUsers.length} user${rawUsers.length === 1 ? "" : "s"}.`,
  ];
  const limitNotice = displayLimitNotice({
    noun: "user",
    total: users.length,
    displayed: displayed.displayed,
    artifactPath: artifact?.path,
  });
  if (limitNotice) lines.push(limitNotice);
  if (artifact) lines.push(`Raw JSON saved to: ${artifact.path}`);
  if (displayed.items.length > 0) {
    lines.push("", ...displayed.items.map(formatUserSummaryLine));
  }
  return buildJiraTextResult({
    text: lines.join("\n").trimEnd(),
    context,
    artifact,
    details: {
      query,
      projectKey,
      issueKey,
      userCount: users.length,
      displayedUserCount: displayed.displayed,
      users: displayed.items,
    },
  });
}
