import type { ToolExecutionContext, ToolExecutionResult } from "../../types.js";
import { optionalString } from "../atlassian/arguments.js";
import { ToolExecutionError } from "../common/tool-error.js";
import { jiraRequest, pathSegment, requireJiraConnection } from "./client.js";
import {
  buildJiraTextResult,
  displayLimitNotice,
  formatFieldSummaryLine,
  formatIssueTypeSummaryLine,
  maybeWriteJiraArtifact,
  summarizeJiraField,
  summarizeJiraIssueType,
  summarizeJiraProject,
  takeDisplayItems,
} from "./format.js";
import { boundedNumber } from "../atlassian/arguments.js";
import {
  fetchJiraFields,
  fieldsFromProjectResult,
  issueTypeIdFromName,
  valuesFromJiraList,
} from "./helpers.js";

export async function executeJiraGetProject(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const connection = await requireJiraConnection(context);
  const projectKey =
    optionalString(args.project_key) ?? connection.defaultProjectKey;
  if (!projectKey) {
    throw new ToolExecutionError(
      "JIRA_PROJECT_REQUIRED",
      "project_key is required because no default Jira project key is configured.",
    );
  }
  const project = await jiraRequest<Record<string, unknown>>(connection, {
    path: `/project/${pathSegment(projectKey)}`,
    signal: context.signal,
  });
  const result: Record<string, unknown> = { project };
  if (args.include_statuses === true) {
    result.statuses = await jiraRequest(connection, {
      path: `/project/${pathSegment(projectKey)}/statuses`,
      signal: context.signal,
    });
  }
  if (args.include_components === true) {
    result.components = await jiraRequest(connection, {
      path: `/project/${pathSegment(projectKey)}/components`,
      signal: context.signal,
    });
  }
  if (args.include_versions === true) {
    result.versions = await jiraRequest(connection, {
      path: `/project/${pathSegment(projectKey)}/versions`,
      signal: context.signal,
    });
  }
  if (args.include_issue_types === true || args.include_create_meta === true) {
    result.issueTypes = Array.isArray(project.issueTypes)
      ? project.issueTypes
      : await jiraRequest(connection, {
          path: `/issue/createmeta/${pathSegment(projectKey)}/issuetypes`,
          signal: context.signal,
        }).catch(() => undefined);
  }
  if (args.include_create_meta === true) {
    const issueTypeId =
      optionalString(args.issue_type_id) ??
      issueTypeIdFromName(
        result.issueTypes,
        optionalString(args.issue_type_name),
      );
    result.createMeta = issueTypeId
      ? await jiraRequest(connection, {
          path: `/issue/createmeta/${pathSegment(projectKey)}/issuetypes/${pathSegment(issueTypeId)}`,
          signal: context.signal,
        })
      : result.issueTypes;
  }
  if (args.include_fields === true) {
    result.fields = await fetchJiraFields(connection, {
      query: optionalString(args.field_query),
      maxResults: boundedNumber(args.field_limit, 50, 1, 100),
      signal: context.signal,
    });
  }
  if (args.include_priorities === true) {
    result.priorities = await jiraRequest(connection, {
      path: "/priority",
      signal: context.signal,
    });
  }
  if (args.include_resolutions === true) {
    result.resolutions = await jiraRequest(connection, {
      path: "/resolution",
      signal: context.signal,
    });
  }
  if (args.include_issue_link_types === true) {
    result.issueLinkTypes = await jiraRequest(connection, {
      path: "/issueLinkType",
      signal: context.signal,
    });
  }
  const artifact = await maybeWriteJiraArtifact(
    context,
    "get-project",
    result,
    args.save_to_file,
  );
  const projectSummary = summarizeJiraProject(project, projectKey);
  const name = projectSummary?.name ?? projectKey;
  const lines = [`Jira project ${projectKey}: ${name}`];
  const includedCounts: Record<string, number> = {};
  for (const key of ["statuses", "components", "versions"] as const) {
    const value = result[key];
    if (Array.isArray(value)) {
      includedCounts[key] = value.length;
      lines.push(`${key}: ${value.length}`);
    }
  }
  const issueTypes = valuesFromJiraList(result.issueTypes);
  const issueTypeSummaries = issueTypes.flatMap((issueType) => {
    const summary = summarizeJiraIssueType(issueType);
    return summary ? [summary] : [];
  });
  const displayedIssueTypes = takeDisplayItems(issueTypeSummaries);
  if (issueTypes.length > 0) {
    includedCounts.issueTypes = issueTypes.length;
    lines.push(
      `issueTypes: ${issueTypes.length}`,
      ...displayedIssueTypes.items.map(formatIssueTypeSummaryLine),
    );
    const notice = displayLimitNotice({
      noun: "issue type",
      total: issueTypeSummaries.length,
      displayed: displayedIssueTypes.displayed,
      artifactPath: artifact?.path,
    });
    if (notice) lines.push(notice);
  }
  const rawFields = fieldsFromProjectResult(result);
  const fieldSummaries = rawFields.flatMap((field) => {
    const summary = summarizeJiraField(field);
    return summary ? [summary] : [];
  });
  const displayedFields = takeDisplayItems(fieldSummaries);
  if (fieldSummaries.length > 0) {
    includedCounts.fields = fieldSummaries.length;
    lines.push(
      `fields: ${fieldSummaries.length}`,
      ...displayedFields.items.map(formatFieldSummaryLine),
    );
  }
  for (const [key, label] of [
    ["priorities", "priorities"],
    ["resolutions", "resolutions"],
    ["issueLinkTypes", "issue link types"],
  ] as const) {
    const value = result[key];
    if (Array.isArray(value)) {
      includedCounts[key] = value.length;
      lines.push(`${label}: ${value.length}`);
    }
  }
  if (artifact) lines.push(`Raw JSON saved to: ${artifact.path}`);
  return buildJiraTextResult({
    text: lines.join("\n"),
    context,
    artifact,
    details: {
      projectKey,
      project: projectSummary,
      includedCounts,
      issueTypes:
        displayedIssueTypes.items.length > 0
          ? displayedIssueTypes.items
          : undefined,
      issueTypeCount: issueTypeSummaries.length || undefined,
      displayedIssueTypeCount: displayedIssueTypes.displayed || undefined,
      fields: displayedFields.items,
      fieldCount: fieldSummaries.length || undefined,
      displayedFieldCount: displayedFields.displayed || undefined,
    },
  });
}
