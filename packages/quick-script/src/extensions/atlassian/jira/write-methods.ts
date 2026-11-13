import { openAsBlob } from "node:fs";
import { basename } from "node:path";
import { anyJson, isArray, jsonObject } from "@nervekit/tools/integrations";
import {
  jiraMultipartRequest,
  jiraRequest,
  pathSegment,
} from "@nervekit/tools/integrations";
import { markdownToAdf } from "@nervekit/tools/integrations";
import { startedOption } from "./edit-methods.js";
import { hasLocalImages, markdownDoc } from "./media.js";
import { noteChange } from "./report.js";
import {
  matchTransition,
  transitionSummary,
} from "@nervekit/tools/integrations";
import {
  MAX_ATTACHMENT_BYTES,
  mediaTypeFor,
  parseHandle,
  statFileRef,
} from "../../../runtime/files/artifacts.js";
import {
  type AttachmentSpec,
  parseAttachmentSpec,
  attachmentReadAuthorizations,
} from "../shared/attachments.js";
import {
  describeField,
  fieldMetaMap,
  listValues,
  missingFields,
  toApiFields,
} from "./field-values.js";
import {
  createFieldMeta,
  pickIssueType,
  projectIssueTypes,
} from "./discovery.js";
import { nonEmptyString, optionalText } from "../../../runtime/sdk-args.js";
import type { SdkEnvironment } from "../../../runtime/sdk-types.js";
import {
  defineMethod,
  orWhenUnsupported,
  type SdkMethod,
} from "../../../runtime/sdk-types.js";
import { jiraIssue, jiraProject, jiraSprint } from "../shared/targets.js";

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

/** A file checked for upload; its bytes are streamed from `path` and never held in memory. */
type LoadedFile = {
  path: string;
  size: number;
  filename: string;
  mediaType: string;
};

function attachmentSpecs(value: unknown): AttachmentSpec[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error(
      "attachments must be an array of file handles or { file, filename? }.",
    );
  }
  return value.map(parseAttachmentSpec);
}

async function loadFile(
  spec: AttachmentSpec,
  env: SdkEnvironment,
): Promise<LoadedFile> {
  const ref = parseHandle(spec.file, env);
  const size = await statFileRef(
    ref,
    MAX_ATTACHMENT_BYTES,
    "Split or compress it.",
  );
  const filename = spec.filename ?? basename(ref.path);
  return { path: ref.path, size, filename, mediaType: mediaTypeFor(filename) };
}

async function uploadFile(env: SdkEnvironment, key: string, file: LoadedFile) {
  const form = new FormData();
  form.append(
    "file",
    await openAsBlob(file.path, { type: file.mediaType }),
    file.filename,
  );
  const data = await jiraMultipartRequest(await env.jira(), {
    parse: anyJson,
    path: `/issue/${pathSegment(key)}/attachments`,
    form,
    signal: env.context.signal,
  });
  const raw = record(Array.isArray(data) ? data[0] : data);
  const id = String(raw.id ?? "");
  noteChange(env, "created", `attachment ${id} on ${key}`);
  return {
    id,
    filename: String(raw.filename ?? file.filename),
    mediaType: String(raw.mimeType ?? file.mediaType),
    size: typeof raw.size === "number" ? raw.size : file.size,
  };
}

export const jiraWriteMethods: SdkMethod[] = [
  defineMethod({
    product: "jira",
    path: "issues.create",
    risk: "external_write",
    options: [
      "project",
      "type",
      "summary",
      "description",
      "fields",
      "attachments",
    ],
    signature:
      "/** Markdown description; `![](name.png)` embeds an `attachments` image. `fields`: names (jira.fields.list), plain values (users by email/name, options by name, Markdown for rich text). Missing or invalid values throw listing the valid ones. */ create(options: { project?: string; type: string; summary: string; description?: string; fields?: Fields; attachments?: AttachmentInput[] }): Promise<{ key: string; id: string; url: string; attachments?: { id: string; filename: string }[] }>",
    parse: (options) => ({
      project: optionalText(options.project)?.trim(),
      type: nonEmptyString(options.type, "type"),
      summary: nonEmptyString(options.summary, "summary"),
      description:
        options.description === undefined
          ? undefined
          : markdownOption(options.description, "description"),
      fields: fieldsOption(options.fields, false),
      attachments: attachmentSpecs(options.attachments),
    }),
    authorize: ({ project, type, summary }) => ({
      targets: project ? [jiraProject(project)] : [],
      summary: `${project ?? "default project"} ${type}: ${summary}`,
    }),
    // Attaching files is part of creating the issue; only the file reads need their own check.
    authorizeAlso: ({ attachments }, env) =>
      attachmentReadAuthorizations(attachments, env),
    resource: ({ project }) => (project ? `project ${project}` : "Jira"),
    async run(
      { project, type, summary, description, fields, attachments },
      env,
    ) {
      const connection = await env.jira();
      const projectKey = project ?? connection.defaultProjectKey;
      if (!projectKey) {
        throw new Error(
          'project is required: pass { project: "APP" } (no default project is configured).',
        );
      }
      // Files are read first, so bad input fails before the issue exists.
      const files: LoadedFile[] = [];
      for (const spec of attachments) files.push(await loadFile(spec, env));
      // Images can only point at attachments that exist: the description is set after the upload.
      const deferred = Boolean(
        description && files.length > 0 && hasLocalImages(description),
      );
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
        ...(description && !deferred
          ? { description: await markdownDoc(env, undefined, description) }
          : {}),
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
      noteChange(env, "created", key);
      const uploaded: { id: string; filename: string }[] = [];
      try {
        for (const file of files) {
          const { id, filename } = await uploadFile(env, key, file);
          uploaded.push({ id, filename });
        }
        if (deferred && description) {
          await jiraRequest(connection, {
            method: "PUT",
            path: `/issue/${pathSegment(key)}`,
            body: {
              fields: { description: await markdownDoc(env, key, description) },
            },
            signal: env.context.signal,
          });
        }
      } catch (error) {
        throw new Error(
          `${key} was created, but ${error instanceof Error ? error.message : String(error)} Finish it with jira.attachments.upload / jira.issues.update; do not create it again.`,
          { cause: error },
        );
      }
      return {
        key,
        id: String(created.id ?? ""),
        url: `${connection.siteUrl}/browse/${key}`,
        ...(uploaded.length > 0 ? { attachments: uploaded } : {}),
      };
    },
  }),
  defineMethod({
    product: "jira",
    path: "issues.update",
    risk: "external_write",
    options: ["key", "fields"],
    signature:
      "/** Replaces the given fields; values as in create; null unassigns. */ update(options: { key: string; fields: Fields }): Promise<{ key: string; url: string; updated: string[] }>",
    parse: (options) => ({
      key: nonEmptyString(options.key, "key"),
      fields: fieldsOption(options.fields, true),
    }),
    authorize: ({ key }) => ({
      targets: [jiraIssue(key)],
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
      noteChange(env, "updated", key);
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
    risk: "external_write",
    options: ["key", "to", "fields", "comment"],
    signature:
      "/** `to` is a status name. Required transition fields (e.g. Resolution) go in `fields`; errors list the valid choices. */ transition(options: { key: string; to: string; fields?: Fields; comment?: string }): Promise<{ key: string; status: string; url: string }>",
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
      targets: [jiraIssue(key)],
      summary: `${key} → ${to}`,
    }),
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
          body: { body: await markdownDoc(env, key, comment) },
          signal: env.context.signal,
        });
      }
      noteChange(env, "updated", key);
      return { key, status, url: `${connection.siteUrl}/browse/${key}` };
    },
  }),
  defineMethod({
    product: "jira",
    path: "comments.add",
    risk: "external_write",
    options: ["key", "body"],
    signature:
      "add(options: { key: string; body: string }): Promise<{ id: string; url: string }>",
    parse: (options) => ({
      key: nonEmptyString(options.key, "key"),
      body: markdownOption(options.body, "body"),
    }),
    authorize: ({ key }) => ({
      targets: [jiraIssue(key)],
      summary: key,
    }),
    resource: ({ key }) => `issue ${key}`,
    async run({ key, body }, env) {
      const connection = await env.jira();
      const comment = await jiraRequest(connection, {
        parse: jsonObject,
        method: "POST",
        path: `/issue/${pathSegment(key)}/comment`,
        body: { body: await markdownDoc(env, key, body) },
        signal: env.context.signal,
      });
      const id = String(comment.id ?? "");
      noteChange(env, "created", `comment ${id} on ${key}`);
      return {
        id,
        url: `${connection.siteUrl}/browse/${key}?focusedCommentId=${id}`,
      };
    },
  }),
  defineMethod({
    product: "jira",
    path: "comments.update",
    risk: "external_write",
    options: ["key", "id", "body"],
    signature:
      "update(options: { key: string; id: string; body: string }): Promise<{ id: string }>",
    parse: (options) => ({
      key: nonEmptyString(options.key, "key"),
      id: nonEmptyString(options.id, "id"),
      body: markdownOption(options.body, "body"),
    }),
    authorize: ({ key, id }) => ({
      targets: [jiraIssue(key)],
      summary: `${key} comment ${id}`,
    }),
    resource: ({ key }) => `issue ${key}`,
    async run({ key, id, body }, env) {
      await jiraRequest(await env.jira(), {
        method: "PUT",
        path: `/issue/${pathSegment(key)}/comment/${pathSegment(id)}`,
        body: { body: await markdownDoc(env, key, body) },
        signal: env.context.signal,
      });
      noteChange(env, "updated", `comment ${id} on ${key}`);
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
      targets: [jiraIssue(key)],
      summary: `${key} comment ${id}`,
    }),
    resource: ({ key }) => `issue ${key}`,
    async run({ key, id }, env) {
      await jiraRequest(await env.jira(), {
        method: "DELETE",
        path: `/issue/${pathSegment(key)}/comment/${pathSegment(id)}`,
        signal: env.context.signal,
      });
      noteChange(env, "deleted", `comment ${id} on ${key}`);
      return { id };
    },
  }),
  defineMethod({
    product: "jira",
    path: "issues.link",
    risk: "external_write",
    options: ["key", "to", "type"],
    signature:
      '/** `type`: link type name or phrase ("Blocks", "is blocked by"); unknown throws the valid ones. */ link(options: { key: string; to: string; type: string }): Promise<{ key: string; to: string; type: string }>',
    parse: (options) => ({
      key: nonEmptyString(options.key, "key"),
      to: nonEmptyString(options.to, "to"),
      type: nonEmptyString(options.type, "type"),
    }),
    authorize: ({ key, to, type }) => ({
      targets: [jiraIssue(key), jiraIssue(to)],
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
      noteChange(env, "created", `link ${key}→${to}`);
      return { key, to, type: match.name };
    },
  }),
  defineMethod({
    product: "jira",
    path: "worklogs.add",
    risk: "external_write",
    options: ["key", "time", "started", "comment"],
    signature:
      '/** `time` like "1h 30m"; `started` any ISO date-time (default now). */ add(options: { key: string; time: string; started?: string; comment?: string }): Promise<WorklogRef>',
    parse: (options) => ({
      key: nonEmptyString(options.key, "key"),
      time: nonEmptyString(options.time, "time"),
      started: startedOption(options.started),
      comment:
        options.comment === undefined
          ? undefined
          : markdownOption(options.comment, "comment"),
    }),
    authorize: ({ key, time }) => ({
      targets: [jiraIssue(key)],
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
      const id = String(worklog.id ?? "");
      noteChange(env, "created", `worklog ${id} on ${key}`);
      return {
        id,
        timeSpent: String(worklog.timeSpent ?? time),
      };
    },
  }),
  defineMethod({
    product: "jira",
    path: "attachments.upload",
    risk: "external_write",
    options: ["key", "file", "filename"],
    signature:
      "/** Max 100 MB. A repeated filename adds a duplicate (unlike Confluence). */ upload(options: { key: string; file: FileHandle; filename?: string }): Promise<JiraAttachment>",
    parse: (options) => ({
      key: nonEmptyString(options.key, "key"),
      spec: parseAttachmentSpec({
        file: options.file,
        filename: options.filename,
      }),
    }),
    authorize: ({ key, spec }) => ({
      targets: [jiraIssue(key)],
      summary: `${key} ← ${spec.filename ?? spec.file}`,
    }),
    authorizeAlso: ({ spec }, env) => attachmentReadAuthorizations([spec], env),
    resource: ({ key }) => `issue ${key}`,
    async run({ key, spec }, env) {
      return await uploadFile(env, key, await loadFile(spec, env));
    },
  }),
  defineMethod({
    product: "jira",
    path: "issues.move",
    risk: "external_write",
    options: ["keys", "sprint"],
    signature:
      '/** Max 50 issues into a sprint (id: projects.get include "sprints") or "backlog". */ move(options: { keys: string[]; sprint: number | "backlog" }): Promise<{ moved: number }>',
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
      targets: [
        ...keys.map(jiraIssue),
        ...(sprint === "backlog" ? [] : [jiraSprint(sprint)]),
      ],
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
