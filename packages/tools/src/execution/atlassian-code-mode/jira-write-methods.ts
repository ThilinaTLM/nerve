import { basename } from "node:path";
import { anyJson, isArray, jsonObject } from "../atlassian/http.js";
import {
  jiraMultipartRequest,
  jiraRequest,
  pathSegment,
} from "../jira/client.js";
import { markdownToAdf } from "../jira/markdown-adf.js";
import { matchTransition, transitionSummary } from "../jira/transitions.js";
import { mediaTypeFor, parseHandle, readFileRef } from "./artifacts.js";
import {
  parseAttachmentSpec,
  attachmentReadAuthorizations,
} from "./attachments.js";
import {
  describeField,
  fieldMetaMap,
  listValues,
  missingFields,
  toApiFields,
} from "./jira-field-values.js";
import {
  createFieldMeta,
  pickIssueType,
  projectIssueTypes,
} from "./jira-discovery.js";
import { nonEmptyString, optionalText } from "./sdk-args.js";
import {
  defineMethod,
  orWhenUnsupported,
  type SdkMethod,
} from "./sdk-types.js";

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MAX_MOVE_KEYS = 50;

function fieldsOption(
  value: unknown,
  required: boolean,
): Record<string, unknown> {
  if (value === undefined && !required) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      'fields must be an object of field names to values, e.g. { "Story Points": 3, Labels: ["a"] }.',
    );
  }
  if (required && Object.keys(value).length === 0) {
    throw new Error("fields must name at least one field to change.");
  }
  return value as Record<string, unknown>;
}

function markdownOption(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} must be a non-empty Markdown string.`);
  }
  return value;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export const jiraWriteMethods: SdkMethod[] = [
  defineMethod({
    product: "jira",
    path: "issues.create",
    risk: "write",
    options: ["project", "type", "summary", "description", "fields"],
    signature:
      "/** Markdown description. `fields` take field names (jira.fields.list) and plain values: users by email/name, options/priority/components by name, Markdown for rich text. Missing required fields or invalid values throw with the valid ones listed. */ create(options: { project?: string; type: string; summary: string; description?: string; fields?: Record<string, unknown> }): Promise<{ key: string; id: string; url: string }>",
    parse: (options) => ({
      project: optionalText(options.project)?.trim(),
      type: nonEmptyString(options.type, "type"),
      summary: nonEmptyString(options.summary, "summary"),
      description:
        options.description === undefined
          ? undefined
          : markdownOption(options.description, "description"),
      fields: fieldsOption(options.fields, false),
    }),
    authorize: ({ project, type, summary }) => ({
      toolName: "jira_create_issue",
      args: {
        ...(project ? { project_key: project } : {}),
        issue_type: type,
        summary,
      },
      summary: `${project ?? "default project"} ${type}: ${summary}`,
    }),
    resource: ({ project }) => (project ? `project ${project}` : "Jira"),
    async run({ project, type, summary, description, fields }, env) {
      const connection = await env.jira();
      const projectKey = project ?? connection.defaultProjectKey;
      if (!projectKey) {
        throw new Error(
          'project is required: pass { project: "APP" } (no default project is configured).',
        );
      }
      const types = await projectIssueTypes(env, projectKey);
      const issueType =
        types.length > 0
          ? pickIssueType(types, type, projectKey)
          : { id: "", name: type, subtask: false };
      const meta = issueType.id
        ? await createFieldMeta(env, projectKey, issueType.id)
        : new Map();
      const payload = {
        ...(await toApiFields(fields, env, meta, { projectKey })),
        project: { key: projectKey },
        issuetype: { name: issueType.name },
        summary,
        ...(description ? { description: markdownToAdf(description) } : {}),
      };
      const missing = missingFields(meta, payload);
      if (missing.length > 0) {
        throw new Error(
          `${issueType.name} in ${projectKey} also requires: ${missing.map(describeField).join("; ")}. Pass them in fields by name.`,
        );
      }
      const created = await jiraRequest(connection, {
        parse: jsonObject,
        method: "POST",
        path: "/issue",
        body: { fields: payload },
        signal: env.context.signal,
      });
      const key = String(created.key ?? "");
      return {
        key,
        id: String(created.id ?? ""),
        url: `${connection.siteUrl}/browse/${key}`,
      };
    },
  }),
  defineMethod({
    product: "jira",
    path: "issues.update",
    risk: "write",
    options: ["key", "fields"],
    signature:
      '/** Sets the given fields (replacing their values), same value rules as create; assign with { Assignee: "ann@example.com" } or null to unassign. */ update(options: { key: string; fields: Record<string, unknown> }): Promise<{ key: string; url: string; updated: string[] }>',
    parse: (options) => ({
      key: nonEmptyString(options.key, "key"),
      fields: fieldsOption(options.fields, true),
    }),
    authorize: ({ key }) => ({
      toolName: "jira_update_issue",
      args: { issue_key: key },
      summary: key,
    }),
    resource: ({ key }) => `issue ${key}`,
    async run({ key, fields }, env) {
      const connection = await env.jira();
      const editable = await jiraRequest(connection, {
        parse: jsonObject,
        path: `/issue/${pathSegment(key)}/editmeta`,
        signal: env.context.signal,
      }).catch(orWhenUnsupported((): Record<string, unknown> => ({})));
      const payload = await toApiFields(
        fields,
        env,
        fieldMetaMap(editable.fields),
        { issueKey: key },
      );
      await jiraRequest(connection, {
        method: "PUT",
        path: `/issue/${pathSegment(key)}`,
        body: { fields: payload },
        signal: env.context.signal,
      });
      return {
        key,
        url: `${connection.siteUrl}/browse/${key}`,
        updated: Object.keys(fields),
      };
    },
  }),
  defineMethod({
    product: "jira",
    path: "issues.transition",
    risk: "write",
    options: ["key", "to", "fields", "comment"],
    signature:
      "/** `to` is the target status name. Required transition fields (e.g. Resolution) go in `fields`; missing ones or an unreachable status throw with the valid choices. */ transition(options: { key: string; to: string; fields?: Record<string, unknown>; comment?: string }): Promise<{ key: string; status: string; url: string }>",
    parse: (options) => ({
      key: nonEmptyString(options.key, "key"),
      to: nonEmptyString(options.to, "to"),
      fields: fieldsOption(options.fields, false),
      comment:
        options.comment === undefined
          ? undefined
          : markdownOption(options.comment, "comment"),
    }),
    authorize: ({ key, to }) => ({
      toolName: "jira_transition_issue",
      args: { issue_key: key, transition: to },
      summary: `${key} → ${to}`,
    }),
    authorizeAlso: ({ key, comment }) =>
      comment
        ? [
            {
              toolName: "jira_manage_comment",
              args: { action: "create", issue_key: key, body: comment },
              summary: key,
            },
          ]
        : [],
    resource: ({ key }) => `issue ${key}`,
    async run({ key, to, fields, comment }, env) {
      const connection = await env.jira();
      const response = await jiraRequest(connection, {
        parse: jsonObject,
        path: `/issue/${pathSegment(key)}/transitions`,
        query: { expand: "transitions.fields" },
        signal: env.context.signal,
      });
      const transitions = isArray(response.transitions)
        ? response.transitions
        : [];
      const transition = matchTransition(transitions, to);
      if (!transition) {
        const choices = transitions.map(transitionSummary);
        throw new Error(
          `${key} cannot move to "${to}". Available: ${
            choices.length > 0
              ? choices
                  .map(
                    (item) =>
                      `"${String(item.to)}" (via "${String(item.name)}")`,
                  )
                  .join(", ")
              : "none (the issue may be in a final status)"
          }.`,
        );
      }
      const { id, to: target, fields: screen } = record(transition);
      const status = String(record(target).name ?? to);
      const meta = fieldMetaMap(screen);
      const payload = await toApiFields(fields, env, meta, { issueKey: key });
      const missing = missingFields(meta, payload);
      if (missing.length > 0) {
        throw new Error(
          `Moving ${key} to "${status}" requires: ${missing.map(describeField).join("; ")}. Pass them in fields by name.`,
        );
      }
      await jiraRequest(connection, {
        method: "POST",
        path: `/issue/${pathSegment(key)}/transitions`,
        body: {
          transition: { id: String(id) },
          ...(Object.keys(payload).length > 0 ? { fields: payload } : {}),
        },
        signal: env.context.signal,
      });
      // `update.comment` is ignored by transitions without a screen, so the
      // comment is posted explicitly once the transition has succeeded.
      if (comment) {
        await jiraRequest(connection, {
          method: "POST",
          path: `/issue/${pathSegment(key)}/comment`,
          body: { body: markdownToAdf(comment) },
          signal: env.context.signal,
        });
      }
      return { key, status, url: `${connection.siteUrl}/browse/${key}` };
    },
  }),
  defineMethod({
    product: "jira",
    path: "comments.add",
    risk: "write",
    options: ["key", "body"],
    signature:
      "/** Markdown body. */ add(options: { key: string; body: string }): Promise<{ id: string; url: string }>",
    parse: (options) => ({
      key: nonEmptyString(options.key, "key"),
      body: markdownOption(options.body, "body"),
    }),
    authorize: ({ key, body }) => ({
      toolName: "jira_manage_comment",
      args: { action: "create", issue_key: key, body },
      summary: key,
    }),
    resource: ({ key }) => `issue ${key}`,
    async run({ key, body }, env) {
      const connection = await env.jira();
      const comment = await jiraRequest(connection, {
        parse: jsonObject,
        method: "POST",
        path: `/issue/${pathSegment(key)}/comment`,
        body: { body: markdownToAdf(body) },
        signal: env.context.signal,
      });
      const id = String(comment.id ?? "");
      return {
        id,
        url: `${connection.siteUrl}/browse/${key}?focusedCommentId=${id}`,
      };
    },
  }),
  defineMethod({
    product: "jira",
    path: "comments.update",
    risk: "write",
    options: ["key", "id", "body"],
    signature:
      "/** Replaces the comment text (Markdown). */ update(options: { key: string; id: string; body: string }): Promise<{ id: string }>",
    parse: (options) => ({
      key: nonEmptyString(options.key, "key"),
      id: nonEmptyString(options.id, "id"),
      body: markdownOption(options.body, "body"),
    }),
    authorize: ({ key, id, body }) => ({
      toolName: "jira_manage_comment",
      args: { action: "update", issue_key: key, comment_id: id, body },
      summary: `${key} comment ${id}`,
    }),
    resource: ({ key }) => `issue ${key}`,
    async run({ key, id, body }, env) {
      await jiraRequest(await env.jira(), {
        method: "PUT",
        path: `/issue/${pathSegment(key)}/comment/${pathSegment(id)}`,
        body: { body: markdownToAdf(body) },
        signal: env.context.signal,
      });
      return { id };
    },
  }),
  defineMethod({
    product: "jira",
    path: "comments.delete",
    risk: "destructive",
    options: ["key", "id"],
    signature:
      "delete(options: { key: string; id: string }): Promise<{ id: string }>",
    parse: (options) => ({
      key: nonEmptyString(options.key, "key"),
      id: nonEmptyString(options.id, "id"),
    }),
    authorize: ({ key, id }) => ({
      toolName: "jira_manage_comment",
      args: { action: "delete", issue_key: key, comment_id: id },
      summary: `${key} comment ${id}`,
    }),
    resource: ({ key }) => `issue ${key}`,
    async run({ key, id }, env) {
      await jiraRequest(await env.jira(), {
        method: "DELETE",
        path: `/issue/${pathSegment(key)}/comment/${pathSegment(id)}`,
        signal: env.context.signal,
      });
      return { id };
    },
  }),
  defineMethod({
    product: "jira",
    path: "issues.link",
    risk: "write",
    options: ["key", "to", "type"],
    signature:
      '/** `type` is a link type name or phrase: "Blocks", "blocks" (key blocks to), "is blocked by". Unknown types throw with the valid ones. */ link(options: { key: string; to: string; type: string }): Promise<{ key: string; to: string; type: string }>',
    parse: (options) => ({
      key: nonEmptyString(options.key, "key"),
      to: nonEmptyString(options.to, "to"),
      type: nonEmptyString(options.type, "type"),
    }),
    authorize: ({ key, to, type }) => ({
      toolName: "jira_manage_issue_link",
      args: {
        action: "create",
        issue_key: key,
        other_issue_key: to,
        link_type: type,
      },
      summary: `${key} ${type} ${to}`,
    }),
    resource: ({ key }) => `issue ${key}`,
    async run({ key, to, type }, env) {
      const connection = await env.jira();
      const response = await jiraRequest(connection, {
        parse: jsonObject,
        path: "/issueLinkType",
        signal: env.context.signal,
      });
      const types = (
        isArray(response.issueLinkTypes) ? response.issueLinkTypes : []
      ).map((raw) => {
        const item = record(raw);
        return {
          name: String(item.name ?? ""),
          inward: String(item.inward ?? ""),
          outward: String(item.outward ?? ""),
        };
      });
      const wanted = type.trim().toLowerCase();
      const byName = types.find((item) => item.name.toLowerCase() === wanted);
      const outward = types.find(
        (item) => item.outward.toLowerCase() === wanted,
      );
      const inward = types.find((item) => item.inward.toLowerCase() === wanted);
      const match = byName ?? outward ?? inward;
      if (!match) {
        throw new Error(
          `Unknown link type "${type}". Valid types: ${listValues(
            types.map(
              (item) => `${item.name} ("${item.outward}" / "${item.inward}")`,
            ),
          )}.`,
        );
      }
      // `key` is the outward side unless the phrase names the inward side.
      const keyIsInward = !byName && !outward && Boolean(inward);
      await jiraRequest(connection, {
        method: "POST",
        path: "/issueLink",
        body: {
          type: { name: match.name },
          inwardIssue: { key: keyIsInward ? key : to },
          outwardIssue: { key: keyIsInward ? to : key },
        },
        signal: env.context.signal,
      });
      return { key, to, type: match.name };
    },
  }),
  defineMethod({
    product: "jira",
    path: "worklogs.add",
    risk: "write",
    options: ["key", "time", "started", "comment"],
    signature:
      '/** `time` like "1h 30m"; `started` any ISO date-time (default now). */ add(options: { key: string; time: string; started?: string; comment?: string }): Promise<{ id: string; timeSpent: string }>',
    parse: (options) => {
      const started =
        options.started === undefined
          ? undefined
          : new Date(nonEmptyString(options.started, "started"));
      if (started && Number.isNaN(started.getTime())) {
        throw new Error(
          "started must be an ISO date-time such as 2026-03-02T09:00:00Z.",
        );
      }
      return {
        key: nonEmptyString(options.key, "key"),
        time: nonEmptyString(options.time, "time"),
        started: started?.toISOString().replace("Z", "+0000"),
        comment:
          options.comment === undefined
            ? undefined
            : markdownOption(options.comment, "comment"),
      };
    },
    authorize: ({ key, time }) => ({
      toolName: "jira_manage_worklog",
      args: { action: "create", issue_key: key, time_spent: time },
      summary: `${key} ${time}`,
    }),
    resource: ({ key }) => `issue ${key}`,
    async run({ key, time, started, comment }, env) {
      const worklog = await jiraRequest(await env.jira(), {
        parse: jsonObject,
        method: "POST",
        path: `/issue/${pathSegment(key)}/worklog`,
        body: {
          timeSpent: time,
          ...(started ? { started } : {}),
          ...(comment ? { comment: markdownToAdf(comment) } : {}),
        },
        signal: env.context.signal,
      });
      return {
        id: String(worklog.id ?? ""),
        timeSpent: String(worklog.timeSpent ?? time),
      };
    },
  }),
  defineMethod({
    product: "jira",
    path: "attachments.upload",
    risk: "write",
    options: ["key", "file", "filename"],
    signature:
      "/** Any file handle; max 25 MB. */ upload(options: { key: string; file: FileHandle; filename?: string }): Promise<{ id: string; filename: string; mediaType: string; size: number }>",
    parse: (options) => ({
      key: nonEmptyString(options.key, "key"),
      spec: parseAttachmentSpec({
        file: options.file,
        filename: options.filename,
      }),
    }),
    authorize: ({ key, spec }) => ({
      toolName: "jira_manage_attachment",
      args: {
        action: "upload",
        issue_key: key,
        file_path: spec.file,
        ...(spec.filename ? { filename: spec.filename } : {}),
      },
      summary: `${key} ← ${spec.filename ?? spec.file}`,
    }),
    authorizeAlso: ({ spec }, env) => attachmentReadAuthorizations([spec], env),
    resource: ({ key }) => `issue ${key}`,
    async run({ key, spec }, env) {
      const ref = parseHandle(spec.file, env);
      const bytes = await readFileRef(ref, MAX_ATTACHMENT_BYTES);
      const filename = spec.filename ?? basename(ref.path);
      const mediaType = mediaTypeFor(filename);
      const form = new FormData();
      form.append(
        "file",
        new Blob([new Uint8Array(bytes)], { type: mediaType }),
        filename,
      );
      const data = await jiraMultipartRequest(await env.jira(), {
        parse: anyJson,
        path: `/issue/${pathSegment(key)}/attachments`,
        form,
        signal: env.context.signal,
      });
      const raw = record(Array.isArray(data) ? data[0] : data);
      return {
        id: String(raw.id ?? ""),
        filename: String(raw.filename ?? filename),
        mediaType: String(raw.mimeType ?? mediaType),
        size: typeof raw.size === "number" ? raw.size : bytes.byteLength,
      };
    },
  }),
  defineMethod({
    product: "jira",
    path: "issues.move",
    risk: "write",
    options: ["keys", "sprint"],
    signature:
      '/** Moves up to 50 issues into a sprint (id from projects.get include "sprints") or back to the backlog. */ move(options: { keys: string[]; sprint: number | "backlog" }): Promise<{ moved: number }>',
    parse: (options) => {
      const keys = options.keys;
      if (
        !Array.isArray(keys) ||
        keys.length === 0 ||
        keys.length > MAX_MOVE_KEYS ||
        keys.some((key) => typeof key !== "string" || !key.trim())
      ) {
        throw new Error(`keys must be 1 to ${MAX_MOVE_KEYS} issue keys.`);
      }
      const sprint = options.sprint;
      if (
        sprint !== "backlog" &&
        !(Number.isInteger(sprint) && (sprint as number) > 0)
      ) {
        throw new Error('sprint must be a sprint id (number) or "backlog".');
      }
      return { keys: keys as string[], sprint: sprint as number | "backlog" };
    },
    authorize: ({ keys, sprint }) => ({
      toolName: "jira_manage_backlog",
      args:
        sprint === "backlog"
          ? { action: "move_to_backlog", issue_key: keys[0] }
          : {
              action: "move_to_sprint",
              issue_key: keys[0],
              sprint_id: String(sprint),
            },
      summary: `${keys.join(", ")} → ${sprint === "backlog" ? "backlog" : `sprint ${sprint}`}`,
    }),
    resource: ({ sprint }) =>
      sprint === "backlog" ? "the backlog" : `sprint ${sprint}`,
    async run({ keys, sprint }, env) {
      await jiraRequest(await env.jira(), {
        api: "agile",
        method: "POST",
        path:
          sprint === "backlog" ? "/backlog/issue" : `/sprint/${sprint}/issue`,
        body: { issues: keys },
        signal: env.context.signal,
      });
      return { moved: keys.length };
    },
  }),
];
