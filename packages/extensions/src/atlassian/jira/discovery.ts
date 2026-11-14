import { jsonArray, jsonObject } from "../shared/http.js";
import { jiraRequest, pathSegment } from "./client.js";
import {
  AUTOMATIC_FIELDS,
  type FieldMeta,
  fieldMetaMap,
  listValues,
} from "./field-values.js";
import { closeMatches } from "../shared/args.js";
import { orWhenUnsupported } from "../shared/errors.js";
import type { JiraSession } from "./session.js";

/** Extra project data `jira.projects.get` returns on request. */
export const PROJECT_INCLUDES = [
  "fields",
  "statuses",
  "releases",
  "boards",
  "sprints",
  "closedSprints",
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
  session: JiraSession,
  projectKey: string,
): Promise<IssueTypeInfo[]> {
  const page = await jiraRequest(session.connection, {
    parse: jsonObject,
    path: `/issue/createmeta/${pathSegment(projectKey)}/issuetypes`,
    query: { maxResults: 100 },
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
  session: JiraSession,
  projectKey: string,
  issueTypeId: string,
): Promise<Map<string, FieldMeta>> {
  const page = await jiraRequest(session.connection, {
    parse: jsonObject,
    path: `/issue/createmeta/${pathSegment(projectKey)}/issuetypes/${pathSegment(issueTypeId)}`,
    query: { maxResults: 200 },
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
  session: JiraSession,
  key: string,
  issueType: string | undefined,
) {
  const all = await projectIssueTypes(session, key);
  const types = issueType ? [pickIssueType(all, issueType, key)] : all;
  return await Promise.all(
    types.map(async (type) => ({
      issueType: type.name,
      subtask: type.subtask,
      fields: [...(await createFieldMeta(session, key, type.id)).values()]
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

async function statuses(session: JiraSession, key: string) {
  const raw = await jiraRequest(session.connection, {
    parse: jsonArray,
    path: `/project/${pathSegment(key)}/statuses`,
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

async function releases(session: JiraSession, key: string) {
  const raw = await jiraRequest(session.connection, {
    parse: jsonArray,
    path: `/project/${pathSegment(key)}/versions`,
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

async function boards(session: JiraSession, key: string) {
  const page = await jiraRequest(session.connection, {
    api: "agile",
    parse: jsonObject,
    path: "/board",
    query: { projectKeyOrId: key, maxResults: LIMIT },
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

/** Closed sprints kept per board: the most recent ones. */
const CLOSED_SPRINTS = 10;
/** Pages read per board when looking for the latest closed sprints. */
const MAX_SPRINT_PAGES = 20;

/** Sprints of one board in `state`, oldest first as Jira returns them; [] for boards without sprints. */
async function boardSprints(
  session: JiraSession,
  boardId: number,
  state: string,
  allPages: boolean,
): Promise<unknown[]> {
  const values: unknown[] = [];
  for (let page = 0; page < (allPages ? MAX_SPRINT_PAGES : 1); page += 1) {
    const response = await jiraRequest(session.connection, {
      api: "agile",
      parse: jsonObject,
      path: `/board/${boardId}/sprint`,
      query: { state, startAt: values.length, maxResults: LIMIT },
    }).catch(orWhenUnsupported((): Record<string, unknown> => ({})));
    const batch = list(response.values);
    values.push(...batch);
    if (batch.length === 0 || response.isLast !== false) break;
  }
  return values;
}

/** Active and future sprints of every board that has them (kanban boards say no); `closed` adds the latest closed ones. */
async function sprints(session: JiraSession, key: string, closed: boolean) {
  const perBoard = await Promise.all(
    (await boards(session, key)).map(async (board) => {
      const [open, done] = await Promise.all([
        boardSprints(session, board.id, "active,future", false),
        closed
          ? boardSprints(session, board.id, "closed", true)
          : Promise.resolve([]),
      ]);
      return [...done.slice(-CLOSED_SPRINTS), ...open].map((item) => {
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
  const seen = new Set<number>();
  return perBoard.flat().filter((sprint) => {
    if (seen.has(sprint.id)) return false;
    seen.add(sprint.id);
    return true;
  });
}

async function epics(session: JiraSession, key: string) {
  const page = await jiraRequest(session.connection, {
    parse: jsonObject,
    method: "POST",
    path: "/search/jql",
    body: {
      jql: `project = "${key.replaceAll('"', "")}" AND issuetype = Epic AND statusCategory != Done ORDER BY updated DESC`,
      fields: ["summary", "status"],
      maxResults: LIMIT,
    },
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
  session: JiraSession,
  key: string,
  include: readonly ProjectInclude[],
  issueType: string | undefined,
): Promise<Record<string, unknown>> {
  const wanted = new Set(include);
  const extras: Record<string, unknown> = {};
  await Promise.all([
    wanted.has("fields") &&
      createFields(session, key, issueType).then(
        (v) => (extras.createFields = v),
      ),
    wanted.has("statuses") &&
      statuses(session, key).then((v) => (extras.statuses = v)),
    wanted.has("releases") &&
      releases(session, key).then((v) => (extras.releases = v)),
    wanted.has("boards") &&
      boards(session, key).then((v) => (extras.boards = v)),
    (wanted.has("sprints") || wanted.has("closedSprints")) &&
      sprints(session, key, wanted.has("closedSprints")).then(
        (v) => (extras.sprints = v),
      ),
    wanted.has("epics") && epics(session, key).then((v) => (extras.epics = v)),
  ]);
  return extras;
}
