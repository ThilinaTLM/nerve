import { jsonObject } from "@nervekit/tools/integrations";
import { jiraRequest, pathSegment } from "@nervekit/tools/integrations";
import { markdownToAdf } from "@nervekit/tools/integrations";
import { issueAttachments } from "./media.js";
import { noteChange } from "./report.js";
import { simplifyWorklog } from "./issue.js";
import { listValues } from "./field-values.js";
import { nonEmptyString, optionalText } from "../../../runtime/sdk-args.js";
import { defineMethod, type SdkMethod } from "../../../runtime/sdk-types.js";
import { jiraAttachment, jiraIssue } from "../shared/targets.js";

const MAX_RANK_KEYS = 50;
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** A `started` option as Jira's date-time, or undefined. */
export function startedOption(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const started = new Date(nonEmptyString(value, "started"));
  if (Number.isNaN(started.getTime())) {
    throw new Error(
      "started must be an ISO date-time such as 2026-03-02T09:00:00Z.",
    );
  }
  return started.toISOString().replace("Z", "+0000");
}

function commentOption(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("comment must be a non-empty Markdown string.");
  }
  return value;
}

export const jiraEditMethods: SdkMethod[] = [
  defineMethod({
    product: "jira",
    path: "issues.rank",
    risk: "external_write",
    options: ["keys", "before", "after"],
    signature: `/** Reorders up to ${MAX_RANK_KEYS} issues before or after another; pass exactly one of before/after. */ rank(options: { keys: string[]; before?: string; after?: string }): Promise<{ ranked: number }>`,
    parse: (options) => {
      const { keys } = options;
      if (
        !Array.isArray(keys) ||
        keys.length === 0 ||
        keys.length > MAX_RANK_KEYS ||
        keys.some((key) => typeof key !== "string" || !key.trim())
      ) {
        throw new Error(`keys must be 1 to ${MAX_RANK_KEYS} issue keys.`);
      }
      const before = optionalText(options.before)?.trim();
      const after = optionalText(options.after)?.trim();
      if (Boolean(before) === Boolean(after)) {
        throw new Error(
          'Pass exactly one of before or after, e.g. { keys: ["APP-3"], before: "APP-1" }.',
        );
      }
      return { keys: keys as string[], before, after };
    },
    authorize: ({ keys, before, after }) => ({
      targets: [...keys, (before ?? after)!].map(jiraIssue),
      summary: `${keys.join(", ")} ${before ? `before ${before}` : `after ${after}`}`,
    }),
    resource: ({ keys }) => `issue ${keys[0]}`,
    async run({ keys, before, after }, env) {
      await jiraRequest(await env.jira(), {
        api: "agile",
        method: "PUT",
        path: "/issue/rank",
        body: {
          issues: keys,
          ...(before ? { rankBeforeIssue: before } : { rankAfterIssue: after }),
        },
        signal: env.context.signal,
      });
      return { ranked: keys.length };
    },
  }),
  defineMethod({
    product: "jira",
    path: "issues.unlink",
    risk: "destructive",
    options: ["key", "to", "type"],
    signature:
      "/** Removes links between two issues (either direction); `type` only if linked several ways. */ unlink(options: { key: string; to: string; type?: string }): Promise<{ key: string; to: string; removed: number }>",
    parse: (options) => ({
      key: nonEmptyString(options.key, "key"),
      to: nonEmptyString(options.to, "to"),
      type: optionalText(options.type)?.trim(),
    }),
    authorize: ({ key, to, type }) => ({
      targets: [jiraIssue(key), jiraIssue(to)],
      summary: `${key} ${type ?? "link"} ${to}`,
    }),
    resource: ({ key }) => `issue ${key}`,
    async run({ key, to, type }, env) {
      const connection = await env.jira();
      const issue = await jiraRequest(connection, {
        parse: jsonObject,
        path: `/issue/${pathSegment(key)}`,
        query: { fields: "issuelinks" },
        signal: env.context.signal,
      });
      const links = list(record(issue.fields).issuelinks).map((raw) => {
        const link = record(raw);
        const kind = record(link.type);
        const outward = record(link.outwardIssue).key !== undefined;
        const other = String(
          record(outward ? link.outwardIssue : link.inwardIssue).key ?? "",
        );
        return {
          id: String(link.id ?? ""),
          other,
          name: String(kind.name ?? ""),
          phrase: String(outward ? kind.outward : kind.inward),
          phrases: [kind.name, kind.inward, kind.outward].map((item) =>
            String(item ?? "").toLowerCase(),
          ),
        };
      });
      const toKey = to.toUpperCase();
      const toThem = links.filter((link) => link.other.toUpperCase() === toKey);
      const wanted = type?.toLowerCase();
      const matches = wanted
        ? toThem.filter((link) => link.phrases.includes(wanted))
        : toThem;
      if (matches.length === 0) {
        throw new Error(
          toThem.length === 0
            ? `${key} has no link to ${to}. Its links: ${listValues(links.map((link) => `${link.phrase} ${link.other}`)) || "none"}.`
            : `${key} is linked to ${to} as ${listValues(toThem.map((link) => `"${link.name}"`))}, not "${type}".`,
        );
      }
      const names = new Set(matches.map((link) => link.name));
      if (!wanted && names.size > 1) {
        throw new Error(
          `${key} is linked to ${to} in several ways (${listValues([...names])}); pass type.`,
        );
      }
      for (const link of matches) {
        await jiraRequest(connection, {
          method: "DELETE",
          path: `/issueLink/${pathSegment(link.id)}`,
          signal: env.context.signal,
        });
      }
      noteChange(env, "deleted", `link ${key}→${to}`);
      return { key, to, removed: matches.length };
    },
  }),
  defineMethod({
    product: "jira",
    path: "worklogs.list",
    risk: "network",
    bare: "key",
    options: ["key"],
    signature:
      '/** All worklogs of an issue (the `worklog` field of issues.get stops at 20). */ list(options: string | { key: string }): Promise<NonNullable<Issue["worklog"]>>',
    parse: (options) => nonEmptyString(options.key, "key"),
    authorize: (key) => ({ targets: [jiraIssue(key)], summary: key }),
    resource: (key) => `issue ${key}`,
    async run(key, env) {
      const connection = await env.jira();
      const all: unknown[] = [];
      for (;;) {
        const page = await jiraRequest(connection, {
          parse: jsonObject,
          path: `/issue/${pathSegment(key)}/worklog`,
          query: { startAt: all.length, maxResults: 1000 },
          signal: env.context.signal,
        });
        const batch = list(page.worklogs);
        all.push(...batch);
        const total = typeof page.total === "number" ? page.total : all.length;
        if (batch.length === 0 || all.length >= total) break;
      }
      return all.map(simplifyWorklog);
    },
  }),
  defineMethod({
    product: "jira",
    path: "worklogs.update",
    risk: "external_write",
    options: ["key", "id", "time", "started", "comment"],
    signature:
      "/** Ids from worklogs.list; only given parts change. */ update(options: { key: string; id: string; time?: string; started?: string; comment?: string }): Promise<WorklogRef>",
    parse: (options) => {
      const parsed = {
        key: nonEmptyString(options.key, "key"),
        id: nonEmptyString(options.id, "id"),
        time: optionalText(options.time)?.trim(),
        started: startedOption(options.started),
        comment: commentOption(options.comment),
      };
      if (!parsed.time && !parsed.started && !parsed.comment) {
        throw new Error("Pass at least one of time, started, comment.");
      }
      return parsed;
    },
    authorize: ({ key, id }) => ({
      targets: [jiraIssue(key)],
      summary: `${key} worklog ${id}`,
    }),
    resource: ({ key }) => `issue ${key}`,
    async run({ key, id, time, started, comment }, env) {
      const worklog = await jiraRequest(await env.jira(), {
        parse: jsonObject,
        method: "PUT",
        path: `/issue/${pathSegment(key)}/worklog/${pathSegment(id)}`,
        body: {
          ...(time ? { timeSpent: time } : {}),
          ...(started ? { started } : {}),
          ...(comment ? { comment: markdownToAdf(comment) } : {}),
        },
        signal: env.context.signal,
      });
      noteChange(env, "updated", `worklog ${id} on ${key}`);
      return { id, timeSpent: String(worklog.timeSpent ?? time ?? "") };
    },
  }),
  defineMethod({
    product: "jira",
    path: "worklogs.delete",
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
      summary: `${key} worklog ${id}`,
    }),
    resource: ({ key }) => `issue ${key}`,
    async run({ key, id }, env) {
      await jiraRequest(await env.jira(), {
        method: "DELETE",
        path: `/issue/${pathSegment(key)}/worklog/${pathSegment(id)}`,
        signal: env.context.signal,
      });
      noteChange(env, "deleted", `worklog ${id} on ${key}`);
      return { id };
    },
  }),
  defineMethod({
    product: "jira",
    path: "attachments.list",
    risk: "network",
    bare: "key",
    options: ["key"],
    signature:
      "/** Oldest first; `![](filename)` embeds the newest duplicate. */ list(options: string | { key: string }): Promise<JiraAttachment[]>",
    parse: (options) => nonEmptyString(options.key, "key"),
    authorize: (key) => ({ targets: [jiraIssue(key)], summary: key }),
    resource: (key) => `issue ${key}`,
    run: (key, env) => issueAttachments(env, key),
  }),
  defineMethod({
    product: "jira",
    path: "attachments.delete",
    risk: "destructive",
    bare: "id",
    options: ["id"],
    signature:
      "delete(options: string | { id: string }): Promise<{ id: string }>",
    parse: (options) => nonEmptyString(options.id, "id"),
    authorize: (id) => ({
      targets: [jiraAttachment(id)],
      summary: `attachment ${id}`,
    }),
    resource: (id) => `attachment ${id}`,
    async run(id, env) {
      await jiraRequest(await env.jira(), {
        method: "DELETE",
        path: `/attachment/${pathSegment(id)}`,
        signal: env.context.signal,
      });
      noteChange(env, "deleted", `attachment ${id}`);
      return { id };
    },
  }),
];
