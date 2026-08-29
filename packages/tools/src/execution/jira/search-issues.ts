import type {
  ToolExecutionContext,
  ToolExecutionResult,
} from "../execution-context.js";
import {
  optionalString,
  optionalStringArray,
  requiredString,
} from "../atlassian/arguments.js";
import { jiraRequest, requireJiraConnection } from "./client.js";
import {
  buildJiraTextResult,
  displayLimitNotice,
  formatIssueSummaryLine,
  summarizeJiraIssue,
  takeDisplayItems,
  writeJiraArtifact,
} from "./format.js";
import { boundedNumber } from "../atlassian/arguments.js";

const DEFAULT_SEARCH_FIELDS = [
  "summary",
  "status",
  "assignee",
  "issuetype",
  "priority",
  "created",
  "updated",
  "resolution",
  "resolutiondate",
  "duedate",
];

type JiraSearchResponse = Record<string, unknown> & {
  issues?: unknown[];
  nextPageToken?: string;
  total?: number;
};

export async function executeJiraSearchIssues(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const connection = await requireJiraConnection(context);
  const jql = requiredString(args.jql, "jql");
  const maxResults = boundedNumber(args.max_results, 25, 1, 100);
  const fields = optionalStringArray(args.fields) ?? DEFAULT_SEARCH_FIELDS;
  const body: Record<string, unknown> = {
    jql,
    maxResults,
    fields,
  };
  const nextPageToken = optionalString(args.next_page_token);
  if (nextPageToken) body.nextPageToken = nextPageToken;
  const data = await jiraRequest<JiraSearchResponse>(connection, {
    method: "POST",
    path: "/search/jql",
    body,
    signal: context.signal,
  });
  const artifact = await writeJiraArtifact(context, "search-issues", data);
  const issues = Array.isArray(data.issues) ? data.issues : [];
  const summarizedIssues = issues.flatMap((issue) => {
    const summary = summarizeJiraIssue(issue);
    return summary ? [summary] : [];
  });
  const displayed = takeDisplayItems(summarizedIssues);
  const total = typeof data.total === "number" ? data.total : undefined;
  const lines = [
    `Jira search returned ${issues.length} issue${issues.length === 1 ? "" : "s"}${total !== undefined ? ` (total ${total})` : ""}.`,
  ];
  if (data.nextPageToken) lines.push(`Next page token: ${data.nextPageToken}`);
  const limitNotice = displayLimitNotice({
    noun: "issue",
    total: summarizedIssues.length,
    displayed: displayed.displayed,
    artifactPath: artifact?.path,
  });
  if (limitNotice) lines.push(limitNotice);
  if (artifact) lines.push(`Raw JSON saved to: ${artifact.path}`);
  if (displayed.items.length > 0) {
    lines.push("", ...displayed.items.map(formatIssueSummaryLine));
  }
  return buildJiraTextResult({
    text: lines.join("\n").trimEnd(),
    context,
    artifact,
    details: {
      jql,
      issueCount: issues.length,
      displayedIssueCount: displayed.displayed,
      total,
      nextPageToken: data.nextPageToken,
      issues: displayed.items,
    },
  });
}
