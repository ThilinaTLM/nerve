import type { CoreToolName } from "@nervekit/contracts";
import type { MetaItem } from "../views/tool-presentation-types";
import type { ToolArgumentSource } from "./argument-source";
import {
  atlassianDraftBody,
  draftField,
  dryRunField,
  optionalDraftField,
} from "./atlassian-draft";
import { boundedText, plural, textArg } from "./core-specs";
import {
  argumentPresentation,
  type ToolArgumentBody,
  type ToolLifecycleSpec,
  type ToolLifecycleStage,
} from "./types";

type JiraToolName = Extract<CoreToolName, `jira_${string}`>;

function spec<Name extends JiraToolName>(
  value: ToolLifecycleSpec<Name>,
): ToolLifecycleSpec<Name> {
  return value;
}

function list(value: string[] | undefined): string | undefined {
  return value && value.length > 0 ? value.join(", ") : undefined;
}

function adfText(value: unknown): string | undefined {
  const parts: string[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    if (record.type === "text" && typeof record.text === "string") {
      parts.push(record.text);
    }
    if (record.content) visit(record.content);
  };
  visit(value);
  const text = parts.join("").trim();
  return text || undefined;
}

function atlassianBody(lines: string[]): ToolArgumentBody {
  const text = boundedText(lines.join("\n"));
  return text ? { kind: "atlassian-summary", text } : { kind: "none" };
}

function assigneeValue(source: ToolArgumentSource): string | undefined {
  const query = source.string("assignee_query");
  if (query) return query;
  const accountId = source.string("assignee_account_id");
  return accountId ? `account ${accountId}` : undefined;
}

function recordKeys(
  source: ToolArgumentSource,
  key: string,
): string | undefined {
  const keys = source.objectKeys(key);
  return keys.length > 0 ? keys.join(", ") : undefined;
}

function dryRunMeta(source: ToolArgumentSource): MetaItem[] {
  return source.boolean("dry_run") === true
    ? [{ text: "dry run", tone: "info" }]
    : [];
}

function mutationSafety(source: ToolArgumentSource, effect: string): string[] {
  return [
    source.boolean("dry_run") === true
      ? `Dry run only; Jira will not ${effect}.`
      : `This will ${effect} in Jira.`,
  ];
}

function readOnlyBody(
  source: ToolArgumentSource,
  stage: ToolLifecycleStage,
  lines: string[],
): ToolArgumentBody | undefined {
  return stage === "approval" ? atlassianBody(lines) : undefined;
}

export const jiraToolLifecycleSpecs = {
  jira_search_users: spec({
    name: "jira_search_users",
    draftBody: "none",
    executingBody: "skeleton",
    approvalDetail: "target",
    executionHandoff: "result-immediate",
    completedView: "jira",
    emptyResult: "No users found",
    present: (source, stage) => {
      const secondary: MetaItem[] = [];
      if (source.string("project_key"))
        secondary.push({
          text: `project ${source.string("project_key")}`,
          mono: true,
        });
      if (source.string("issue_key"))
        secondary.push({ text: source.string("issue_key")!, mono: true });
      if (source.number("max_results") !== undefined)
        secondary.push({ text: `max ${source.number("max_results")}` });
      if (source.boolean("include_inactive"))
        secondary.push({ text: "include inactive" });
      return argumentPresentation({
        primaryArg: textArg(source.string("query"), "User query"),
        secondary,
        body: readOnlyBody(source, stage, [
          `Query: ${source.string("query") ?? ""}`,
          ...(source.string("project_key")
            ? [`Project: ${source.string("project_key")}`]
            : []),
          ...(source.string("issue_key")
            ? [`Issue: ${source.string("issue_key")}`]
            : []),
        ]),
      });
    },
  }),
  jira_search_issues: spec({
    name: "jira_search_issues",
    draftBody: "none",
    executingBody: "skeleton",
    approvalDetail: "target",
    executionHandoff: "result-immediate",
    completedView: "jira",
    emptyResult: "No issues found",
    present: (source, stage) => {
      const fields = source.strings("fields");
      const secondary: MetaItem[] = [];
      if (fields) secondary.push({ text: plural(fields.length, "field") });
      if (source.number("max_results") !== undefined)
        secondary.push({ text: `max ${source.number("max_results")}` });
      if (source.string("next_page_token"))
        secondary.push({ text: "next page" });
      if (source.boolean("save_to_file") === false)
        secondary.push({ text: "not saved" });
      return argumentPresentation({
        primaryArg: textArg(source.string("jql"), "JQL"),
        secondary,
        body: readOnlyBody(source, stage, [
          `JQL: ${source.string("jql") ?? ""}`,
          ...(fields?.length ? [`Fields: ${fields.join(", ")}`] : []),
        ]),
      });
    },
  }),
  jira_get_issue: spec({
    name: "jira_get_issue",
    draftBody: "none",
    executingBody: "skeleton",
    approvalDetail: "target",
    executionHandoff: "result-immediate",
    completedView: "jira",
    present: (source, stage) => {
      const includes = [
        ["include_comments", "comments"],
        ["include_transitions", "transitions"],
        ["include_editmeta", "edit metadata"],
        ["include_worklogs", "worklogs"],
        ["include_changelog", "changelog"],
        ["include_remote_links", "remote links"],
      ].flatMap(([key, label]) => (source.boolean(key) ? [label] : []));
      return argumentPresentation({
        primaryArg: textArg(source.string("issue_key"), "Issue"),
        secondary: includes.map((text) => ({ text })),
        body: readOnlyBody(source, stage, [
          `Issue: ${source.string("issue_key") ?? ""}`,
          ...(includes.length > 0 ? [`Include: ${includes.join(", ")}`] : []),
        ]),
      });
    },
  }),
  jira_get_project: spec({
    name: "jira_get_project",
    draftBody: "none",
    executingBody: "skeleton",
    approvalDetail: "target",
    executionHandoff: "result-immediate",
    completedView: "jira",
    present: (source, stage) => {
      const project = source.string("project_key") ?? "default project";
      const includes = [
        ["include_statuses", "statuses"],
        ["include_components", "components"],
        ["include_versions", "versions"],
        ["include_issue_types", "issue types"],
        ["include_create_meta", "create metadata"],
        ["include_fields", "fields"],
      ].flatMap(([key, label]) => (source.boolean(key) ? [label] : []));
      return argumentPresentation({
        primaryArg: textArg(project),
        secondary: includes.map((text) => ({ text })),
        body: readOnlyBody(source, stage, [
          `Project: ${project}`,
          ...(includes.length > 0 ? [`Include: ${includes.join(", ")}`] : []),
        ]),
      });
    },
  }),
  jira_create_issue: spec({
    name: "jira_create_issue",
    draftBody: "meaningful",
    approvalDetail: "full",
    executionHandoff: "retain-draft-until-output",
    completedView: "jira",
    present: (source) => {
      const project = source.string("project_key");
      const issueType = source.string("issue_type");
      const summary = source.string("summary");
      const body = atlassianDraftBody({
        fields: [
          draftField("Project", project, { mono: true }),
          draftField("Type", issueType),
          draftField("Summary", summary),
          ...optionalDraftField("Parent", source.string("parent_key"), {
            mono: true,
          }),
          ...optionalDraftField("Priority", source.string("priority")),
          ...optionalDraftField("Assignee", assigneeValue(source)),
          ...optionalDraftField("Labels", list(source.strings("labels"))),
          ...optionalDraftField(
            "Components",
            list(source.strings("components")),
          ),
          ...optionalDraftField("Custom fields", recordKeys(source, "fields"), {
            mono: true,
          }),
          ...dryRunField(source),
        ],
        text: {
          label: "Description",
          text:
            source.string("description") ??
            adfText(source.value("description_adf")),
        },
      });
      return argumentPresentation({
        primaryArg: textArg(
          [project, issueType, summary].filter(Boolean).join(" · "),
          "New Jira issue",
        ),
        secondary: [
          ...dryRunMeta(source),
          ...(source.strings("labels")
            ? [{ text: plural(source.strings("labels")!.length, "label") }]
            : []),
        ],
        body,
        safetyNotes: mutationSafety(source, "create an issue"),
      });
    },
  }),
  jira_update_issue: spec({
    name: "jira_update_issue",
    draftBody: "meaningful",
    approvalDetail: "full",
    executionHandoff: "retain-draft-until-output",
    completedView: "jira",
    present: (source) => {
      const description =
        source.string("description") ??
        adfText(source.value("description_adf"));
      const changes = [
        ...optionalDraftField("Summary", source.string("summary")),
        ...optionalDraftField("Priority", source.string("priority")),
        ...optionalDraftField("Assignee", assigneeValue(source)),
        ...optionalDraftField("Labels", list(source.strings("labels"))),
        ...optionalDraftField("Field keys", recordKeys(source, "fields"), {
          mono: true,
        }),
        ...optionalDraftField("Update ops", recordKeys(source, "update"), {
          mono: true,
        }),
      ];
      const changed = changes.length + (description !== undefined ? 1 : 0);
      const body = atlassianDraftBody({
        fields: [
          draftField("Issue", source.string("issue_key"), { mono: true }),
          ...changes,
          ...(source.boolean("notify_users") === false
            ? [draftField("Notify users", "no")]
            : []),
          ...dryRunField(source),
        ],
        text:
          description !== undefined
            ? { label: "Description", text: description }
            : undefined,
      });
      return argumentPresentation({
        primaryArg: textArg(source.string("issue_key"), "Issue"),
        secondary: [
          ...dryRunMeta(source),
          ...(changed > 0 ? [{ text: plural(changed, "change") }] : []),
        ],
        body,
        safetyNotes: mutationSafety(source, "update the issue"),
      });
    },
  }),
  jira_add_comment: spec({
    name: "jira_add_comment",
    draftBody: "meaningful",
    approvalDetail: "full",
    executionHandoff: "retain-draft-until-output",
    completedView: "jira",
    present: (source) => {
      const visibility = source.record("visibility");
      const body = atlassianDraftBody({
        fields: [
          draftField("Issue", source.string("issue_key"), { mono: true }),
          ...optionalDraftField(
            "Visibility",
            visibility
              ? [visibility.type, visibility.value]
                  .filter((part): part is string => typeof part === "string")
                  .join(" · ")
              : undefined,
          ),
        ],
        text: {
          label: "Comment",
          text: source.string("body") ?? adfText(source.value("body_adf")),
        },
      });
      return argumentPresentation({
        primaryArg: textArg(source.string("issue_key"), "Issue"),
        secondary: [{ text: source.record("body_adf") ? "ADF" : "plain text" }],
        body,
        safetyNotes: ["Adds this comment to the selected Jira issue."],
      });
    },
  }),
  jira_transition_issue: spec({
    name: "jira_transition_issue",
    draftBody: "meaningful",
    approvalDetail: "full",
    executionHandoff: "retain-draft-until-output",
    completedView: "jira",
    present: (source) => {
      const transition =
        source.string("transition") ?? "list available transitions";
      const comment =
        source.string("comment") ?? adfText(source.value("comment_adf"));
      const body = atlassianDraftBody({
        fields: [
          draftField("Issue", source.string("issue_key"), { mono: true }),
          draftField("Transition", source.string("transition")),
          ...optionalDraftField("Resolution", source.string("resolution")),
          ...optionalDraftField("Field keys", recordKeys(source, "fields"), {
            mono: true,
          }),
          ...optionalDraftField("Update ops", recordKeys(source, "update"), {
            mono: true,
          }),
          ...dryRunField(source),
        ],
        text:
          comment !== undefined
            ? { label: "Comment", text: comment }
            : undefined,
      });
      return argumentPresentation({
        primaryArg: textArg(
          [source.string("issue_key"), transition].filter(Boolean).join(" · "),
          "Issue transition",
        ),
        secondary: dryRunMeta(source),
        body,
        safetyNotes: mutationSafety(source, "transition the issue"),
      });
    },
  }),
} satisfies Record<JiraToolName, ToolLifecycleSpec>;
