import type {
  IntegrationExecutionContext,
  ToolExecutionResult,
} from "../execution-context.js";
import { enumSet, optionalString } from "../atlassian/arguments.js";
import { ToolExecutionError } from "../errors/tool-error.js";
import { jiraRequest, pathSegment, requireJiraConnection } from "./client.js";
import {
  buildJiraTextResult,
  displayLimitNotice,
  formatFieldSummaryLine,
  formatIssueTypeSummaryLine,
  writeJiraArtifact,
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
} from "./field-resolution.js";

export async function executeJiraGetProject(
  args: Record<string, unknown>,
  context: IntegrationExecutionContext,
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
  const include = enumSet(args.include, [
    "statuses",
    "components",
    "versions",
    "issue_types",
    "create_meta",
    "fields",
    "priorities",
    "resolutions",
    "issue_link_types",
  ] as const);
  const project = await jiraRequest<Record<string, unknown>>(connection, {
    path: `/project/${pathSegment(projectKey)}`,
    signal: context.signal,
  });
  const result: Record<string, unknown> = { project };
  if (include.has("statuses")) {
    result.statuses = await jiraRequest(connection, {
      path: `/project/${pathSegment(projectKey)}/statuses`,
      signal: context.signal,
    });
  }
  if (include.has("components")) {
    result.components = await jiraRequest(connection, {
      path: `/project/${pathSegment(projectKey)}/components`,
      signal: context.signal,
    });
  }
  if (include.has("versions")) {
    result.versions = await jiraRequest(connection, {
      path: `/project/${pathSegment(projectKey)}/versions`,
      signal: context.signal,
    });
  }
  if (include.has("issue_types") || include.has("create_meta")) {
    result.issueTypes = Array.isArray(project.issueTypes)
      ? project.issueTypes
      : await jiraRequest(connection, {
          path: `/issue/createmeta/${pathSegment(projectKey)}/issuetypes`,
          signal: context.signal,
        }).catch(() => undefined);
  }
  if (include.has("create_meta")) {
    const issueType = optionalString(args.issue_type);
    const issueTypeId =
      issueType && /^\d+$/.test(issueType)
        ? issueType
        : issueTypeIdFromName(result.issueTypes, issueType);
    result.createMeta = issueTypeId
      ? await jiraRequest(connection, {
          path: `/issue/createmeta/${pathSegment(projectKey)}/issuetypes/${pathSegment(issueTypeId)}`,
          signal: context.signal,
        })
      : result.issueTypes;
  }
  if (include.has("fields")) {
    result.fields = await fetchJiraFields(connection, {
      query: optionalString(args.field_query),
      maxResults: boundedNumber(args.field_limit, 50, 1, 100),
      signal: context.signal,
    });
  }
  if (include.has("priorities")) {
    result.priorities = await jiraRequest(connection, {
      path: "/priority",
      signal: context.signal,
    });
  }
  if (include.has("resolutions")) {
    result.resolutions = await jiraRequest(connection, {
      path: "/resolution",
      signal: context.signal,
    });
  }
  if (include.has("issue_link_types")) {
    result.issueLinkTypes = await jiraRequest(connection, {
      path: "/issueLinkType",
      signal: context.signal,
    });
  }
  const artifact = await writeJiraArtifact(context, "get-project", result);
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
  lines.push(`Raw JSON saved to: ${artifact.path}`);
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
