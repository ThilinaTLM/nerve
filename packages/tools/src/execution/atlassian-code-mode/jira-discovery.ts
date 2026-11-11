import { jsonArray, jsonObject } from "../atlassian/http.js";
import { jiraRequest, pathSegment } from "../jira/client.js";
import {
  AUTOMATIC_FIELDS,
  type FieldMeta,
  fieldMetaMap,
  listValues,
} from "./jira-field-values.js";
import { closeMatches } from "./sdk-args.js";
import { orWhenUnsupported, type SdkEnvironment } from "./sdk-types.js";

/** Extra project data `jira.projects.get` returns on request. */
export const PROJECT_INCLUDES = [
  "fields",
  "statuses",
  "releases",
  "boards",
  "sprints",
  "epics",
] as const;
export type ProjectInclude = (typeof PROJECT_INCLUDES)[number];

const LIMIT = 50;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

export type IssueTypeInfo = { id: string; name: string; subtask: boolean };

/** Issue types the user can create in a project (createmeta). */
export async function projectIssueTypes(
  env: SdkEnvironment,
  projectKey: string,
): Promise<IssueTypeInfo[]> {
  const page = await jiraRequest(await env.jira(), {
    parse: jsonObject,
    path: `/issue/createmeta/${pathSegment(projectKey)}/issuetypes`,
    query: { maxResults: 100 },
    signal: env.context.signal,
  });
  return list(page.issueTypes ?? page.values).map((raw) => {
    const type = record(raw);
    return {
      id: String(type.id ?? ""),
      name: String(type.name ?? ""),
      subtask: type.subtask === true,
    };
  });
}

/** Fields of one issue type's create screen; empty when Jira does not say. */
export async function createFieldMeta(
  env: SdkEnvironment,
  projectKey: string,
  issueTypeId: string,
): Promise<Map<string, FieldMeta>> {
  const page = await jiraRequest(await env.jira(), {
    parse: jsonObject,
    path: `/issue/createmeta/${pathSegment(projectKey)}/issuetypes/${pathSegment(issueTypeId)}`,
    query: { maxResults: 200 },
    signal: env.context.signal,
  }).catch(orWhenUnsupported((): Record<string, unknown> => ({})));
  return fieldMetaMap(page.fields ?? page.values);
}

/** The issue type named `name` (case-insensitive), or an error listing the valid ones. */
export function pickIssueType(
  types: IssueTypeInfo[],
  name: string,
  projectKey: string,
): IssueTypeInfo {
  const found = types.find(
    (type) => type.name.toLowerCase() === name.trim().toLowerCase(),
  );
  if (found) return found;
  const close = closeMatches(
    name,
    types.map((type) => type.name),
    3,
  );
  throw new Error(
    `Unknown issue type "${name}" in project ${projectKey}.${close.length ? ` Did you mean: ${close.map((item) => `"${item}"`).join(", ")}?` : ""} Valid types: ${listValues(types.map((type) => type.name))}.`,
  );
}

const typeName = (field: FieldMeta) =>
  field.items ? `${field.type}<${field.items}>` : (field.type ?? "unknown");

async function createFields(
  env: SdkEnvironment,
  key: string,
  issueType: string | undefined,
) {
  const all = await projectIssueTypes(env, key);
  const types = issueType ? [pickIssueType(all, issueType, key)] : all;
  return await Promise.all(
    types.map(async (type) => ({
      issueType: type.name,
      subtask: type.subtask,
      fields: [...(await createFieldMeta(env, key, type.id)).values()]
        .filter((field) => !AUTOMATIC_FIELDS.has(field.id))
        .map((field) => ({
          name: field.name,
          required: field.required && !field.hasDefault,
          type: typeName(field),
          ...(field.allowed ? { allowed: field.allowed.slice(0, 40) } : {}),
        })),
    })),
  );
}

async function statuses(env: SdkEnvironment, key: string) {
  const raw = await jiraRequest(await env.jira(), {
    parse: jsonArray,
    path: `/project/${pathSegment(key)}/statuses`,
    signal: env.context.signal,
  });
  return raw.map((item) => {
    const type = record(item);
    return {
      issueType: String(type.name ?? ""),
      statuses: list(type.statuses).map((status) => {
        const info = record(status);
        return `${String(info.name ?? "")} (${text(record(info.statusCategory).name) ?? "?"})`;
      }),
    };
  });
}

async function releases(env: SdkEnvironment, key: string) {
  const raw = await jiraRequest(await env.jira(), {
    parse: jsonArray,
    path: `/project/${pathSegment(key)}/versions`,
    signal: env.context.signal,
  });
  return raw
    .map((item) => {
      const version = record(item);
      return {
        name: String(version.name ?? ""),
        released: version.released === true,
        archived: version.archived === true,
        releaseDate: text(version.releaseDate),
        startDate: text(version.startDate),
      };
    })
    .filter((version) => !version.archived)
    .sort(
      (a, b) =>
        Number(a.released) - Number(b.released) ||
        (b.releaseDate ?? "").localeCompare(a.releaseDate ?? ""),
    )
    .slice(0, 100);
}

async function boards(env: SdkEnvironment, key: string) {
  const page = await jiraRequest(await env.jira(), {
    api: "agile",
    parse: jsonObject,
    path: "/board",
    query: { projectKeyOrId: key, maxResults: LIMIT },
    signal: env.context.signal,
  });
  return list(page.values).map((item) => {
    const board = record(item);
    return {
      id: Number(board.id),
      name: String(board.name ?? ""),
      type: text(board.type),
    };
  });
}

/** Active and future sprints of the project's scrum boards. */
async function sprints(env: SdkEnvironment, key: string) {
  const scrum = (await boards(env, key)).filter(
    (board) => board.type === "scrum",
  );
  const perBoard = await Promise.all(
    scrum.map(async (board) => {
      const page = await jiraRequest(await env.jira(), {
        api: "agile",
        parse: jsonObject,
        path: `/board/${board.id}/sprint`,
        query: { state: "active,future", maxResults: LIMIT },
        signal: env.context.signal,
      }).catch(orWhenUnsupported((): Record<string, unknown> => ({})));
      return list(page.values).map((item) => {
        const sprint = record(item);
        return {
          id: Number(sprint.id),
          name: String(sprint.name ?? ""),
          state: text(sprint.state),
          startDate: text(sprint.startDate),
          endDate: text(sprint.endDate),
          goal: text(sprint.goal),
          boardId: board.id,
        };
      });
    }),
  );
  return perBoard.flat();
}

async function epics(env: SdkEnvironment, key: string) {
  const page = await jiraRequest(await env.jira(), {
    parse: jsonObject,
    method: "POST",
    path: "/search/jql",
    body: {
      jql: `project = "${key.replaceAll('"', "")}" AND issuetype = Epic AND statusCategory != Done ORDER BY updated DESC`,
      fields: ["summary", "status"],
      maxResults: LIMIT,
    },
    signal: env.context.signal,
  });
  return list(page.issues).map((item) => {
    const issue = record(item);
    const fields = record(issue.fields);
    return {
      key: String(issue.key ?? ""),
      summary: text(fields.summary),
      status: text(record(fields.status).name),
    };
  });
}

/** The opt-in parts of `jira.projects.get`, fetched in parallel. */
export async function projectExtras(
  env: SdkEnvironment,
  key: string,
  include: readonly ProjectInclude[],
  issueType: string | undefined,
): Promise<Record<string, unknown>> {
  const wanted = new Set(include);
  const extras: Record<string, unknown> = {};
  await Promise.all([
    wanted.has("fields") &&
      createFields(env, key, issueType).then((v) => (extras.createFields = v)),
    wanted.has("statuses") &&
      statuses(env, key).then((v) => (extras.statuses = v)),
    wanted.has("releases") &&
      releases(env, key).then((v) => (extras.releases = v)),
    wanted.has("boards") && boards(env, key).then((v) => (extras.boards = v)),
    wanted.has("sprints") &&
      sprints(env, key).then((v) => (extras.sprints = v)),
    wanted.has("epics") && epics(env, key).then((v) => (extras.epics = v)),
  ]);
  return extras;
}
