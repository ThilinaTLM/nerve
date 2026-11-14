import { jsonObject } from "../shared/http.js";
import { jiraRequest, pathSegment } from "./client.js";
import {
  DEFAULT_SEARCH_FIELDS,
  defaultSelection,
  flattenIssue,
  resolveFieldSelection,
} from "./issue.js";
import { noteChange } from "./report.js";
import { clampInt, nonEmptyString, optionalText } from "../shared/args.js";
import { jiraBoard, jiraProject, jiraSprint } from "../shared/targets.js";
import { defineMethod, type PathedMethod } from "../shared/define-method.js";
import type { JiraSession } from "./session.js";

const PAGE = 50;
const MAX_ISSUES = 1000;

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

function sprintOf(raw: Record<string, unknown>) {
  return {
    id: Number(raw.id),
    name: String(raw.name ?? ""),
    state: text(raw.state),
    startDate: text(raw.startDate),
    endDate: text(raw.endDate),
    goal: text(raw.goal),
    boardId: Number(raw.originBoardId) || 0,
  };
}

function sprintId(value: unknown, name = "id"): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(
      `${name} must be a sprint id (number; jira.projects.get with include ["sprints"] lists them).`,
    );
  }
  return id;
}

function dateOption(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  const date = new Date(nonEmptyString(value, name));
  if (Number.isNaN(date.getTime())) {
    throw new Error(
      `${name} must be an ISO date or date-time such as 2026-03-02 or 2026-03-02T09:00:00Z.`,
    );
  }
  return date.toISOString();
}

/** "2w", "10d" or "1w 3d" in days. */
function durationDays(value: unknown): number {
  const text = nonEmptyString(value, "duration").toLowerCase();
  const parts = [...text.matchAll(/(\d+)\s*([wd])/g)];
  if (
    parts.length === 0 ||
    parts
      .map((part) => part[0])
      .join("")
      .replace(/\s/g, "") !== text.replace(/\s/g, "")
  ) {
    throw new Error('duration must look like "2w", "10d" or "1w 3d".');
  }
  return parts.reduce(
    (days, part) => days + Number(part[1]) * (part[2] === "w" ? 7 : 1),
    0,
  );
}

async function getSprint(session: JiraSession, id: number) {
  return await jiraRequest(session.connection, {
    api: "agile",
    parse: jsonObject,
    path: `/sprint/${id}`,
  });
}

/** Full update (PUT replaces the sprint): current values overlaid with `changes`. */
async function putSprint(
  session: JiraSession,
  current: Record<string, unknown>,
  changes: Record<string, unknown>,
) {
  const body: Record<string, unknown> = {};
  for (const key of ["name", "goal", "state", "startDate", "endDate"]) {
    const value = changes[key] ?? current[key];
    if (value !== undefined && value !== null) body[key] = value;
  }
  return sprintOf(
    await jiraRequest(session.connection, {
      api: "agile",
      parse: jsonObject,
      method: "PUT",
      path: `/sprint/${current.id}`,
      body,
    }),
  );
}

/** Board for a new sprint: the given one, or the project's only scrum or team-managed board. */
async function boardFor(
  session: JiraSession,
  board: number | undefined,
  project: string | undefined,
): Promise<number> {
  if (board !== undefined) return board;
  const key = project ?? session.connection.defaultProjectKey;
  if (!key) {
    throw new Error(
      'Pass board (id) or project (key): { project: "APP", name: "Sprint 5" }.',
    );
  }
  const page = await jiraRequest(session.connection, {
    api: "agile",
    parse: jsonObject,
    path: "/board",
    query: { projectKeyOrId: key, maxResults: PAGE },
  });
  // Scrum and team-managed (`simple`) boards support sprints; kanban boards do not.
  const boards = list(page.values)
    .map((raw) => (raw ?? {}) as Record<string, unknown>)
    .filter((item) => item.type !== "kanban")
    .map((item) => ({ id: Number(item.id), name: String(item.name ?? "") }));
  if (boards.length === 1) return boards[0].id;
  throw new Error(
    boards.length === 0
      ? `Project ${key} has no scrum or team-managed board, which sprints need. Pass board (id) if one exists.`
      : `Project ${key} has several boards: ${boards.map((item) => `${item.name} (${item.id})`).join(", ")}. Pass board.`,
  );
}

/** Keys of a sprint's issues, optionally filtered by JQL. */
async function sprintIssues(
  session: JiraSession,
  id: number,
  query: { jql?: string; fields: string[]; limit: number },
) {
  const out: unknown[] = [];
  while (out.length < query.limit) {
    const page = await jiraRequest(session.connection, {
      api: "agile",
      parse: jsonObject,
      path: `/sprint/${id}/issue`,
      query: {
        jql: query.jql,
        fields: query.fields,
        startAt: out.length,
        maxResults: Math.min(PAGE, query.limit - out.length),
      },
    });
    const batch = list(page.issues);
    out.push(...batch);
    const total = typeof page.total === "number" ? page.total : out.length;
    if (batch.length === 0 || out.length >= total) break;
  }
  return out;
}

async function moveIssues(
  session: JiraSession,
  keys: string[],
  target: number | "backlog",
) {
  for (let i = 0; i < keys.length; i += PAGE) {
    await jiraRequest(session.connection, {
      api: "agile",
      method: "POST",
      path: target === "backlog" ? "/backlog/issue" : `/sprint/${target}/issue`,
      body: { issues: keys.slice(i, i + PAGE) },
    });
  }
}

const sprintAuthorization = (id: number) => ({
  targets: [jiraSprint(id)],
  summary: `sprint ${id}`,
});

const SPRINT = "Sprint";

export const jiraSprintMethods: PathedMethod<JiraSession>[] = [
  defineMethod({
    product: "jira",
    path: "sprints.create",
    risk: "external_write",
    options: ["board", "project", "name", "goal", "startDate", "endDate"],
    signature: `/** Creates a future sprint; \`board\` defaults to the project's only scrum board. */ create(options: { board?: number; project?: string; name: string; goal?: string; startDate?: string; endDate?: string }): Promise<${SPRINT}>`,
    parse: (options) => ({
      board:
        options.board === undefined
          ? undefined
          : sprintId(options.board, "board"),
      project: optionalText(options.project)?.trim(),
      name: nonEmptyString(options.name, "name"),
      goal: optionalText(options.goal),
      startDate: dateOption(options.startDate, "startDate"),
      endDate: dateOption(options.endDate, "endDate"),
    }),
    authorize: ({ board, project, name }) => ({
      targets:
        board !== undefined
          ? [jiraBoard(board)]
          : project
            ? [jiraProject(project)]
            : [],
      summary: name,
    }),
    resource: ({ project, board }) =>
      board === undefined ? `project ${project ?? "Jira"}` : `board ${board}`,
    async run({ board, project, name, goal, startDate, endDate }, session) {
      const originBoardId = await boardFor(session, board, project);
      const created = sprintOf(
        await jiraRequest(session.connection, {
          api: "agile",
          parse: jsonObject,
          method: "POST",
          path: "/sprint",
          body: {
            name,
            originBoardId,
            ...(goal ? { goal } : {}),
            ...(startDate ? { startDate } : {}),
            ...(endDate ? { endDate } : {}),
          },
        }),
      );
      noteChange(session, "created", `sprint ${created.id}`);
      return { ...created, boardId: created.boardId || originBoardId };
    },
  }),
  defineMethod({
    product: "jira",
    path: "sprints.update",
    risk: "external_write",
    options: ["id", "name", "goal", "startDate", "endDate"],
    signature: `update(options: { id: number; name?: string; goal?: string; startDate?: string; endDate?: string }): Promise<${SPRINT}>`,
    parse: (options) => {
      const changes = {
        name: optionalText(options.name),
        goal: optionalText(options.goal),
        startDate: dateOption(options.startDate, "startDate"),
        endDate: dateOption(options.endDate, "endDate"),
      };
      if (Object.values(changes).every((value) => value === undefined)) {
        throw new Error("Pass at least one of name, goal, startDate, endDate.");
      }
      return { id: sprintId(options.id), changes };
    },
    authorize: ({ id }) => sprintAuthorization(id),
    resource: ({ id }) => `sprint ${id}`,
    async run({ id, changes }, session) {
      const current = await getSprint(session, id);
      const updated = await putSprint(session, current, changes);
      noteChange(session, "updated", `sprint ${id}`);
      return updated;
    },
  }),
  defineMethod({
    product: "jira",
    path: "sprints.start",
    risk: "external_write",
    options: ["id", "endDate", "duration"],
    signature: `/** Starts a future sprint now. Needs \`endDate\` or \`duration\` ("2w", "10d") unless the sprint already has an end date. */ start(options: { id: number; endDate?: string; duration?: string }): Promise<${SPRINT}>`,
    parse: (options) => {
      if (options.endDate !== undefined && options.duration !== undefined) {
        throw new Error("Pass endDate or duration, not both.");
      }
      return {
        id: sprintId(options.id),
        endDate: dateOption(options.endDate, "endDate"),
        days:
          options.duration === undefined
            ? undefined
            : durationDays(options.duration),
      };
    },
    authorize: ({ id }) => sprintAuthorization(id),
    resource: ({ id }) => `sprint ${id}`,
    async run({ id, endDate, days }, session) {
      const current = await getSprint(session, id);
      if (current.state !== "future") {
        throw new Error(
          `Sprint ${id} is ${String(current.state)}; only a future sprint can be started.`,
        );
      }
      const now = new Date();
      const end =
        endDate ??
        (days === undefined
          ? text(current.endDate)
          : new Date(now.getTime() + days * 86_400_000).toISOString());
      if (!end) {
        throw new Error(
          `Sprint ${id} has no end date: pass endDate or duration (e.g. "2w").`,
        );
      }
      const started = await putSprint(session, current, {
        state: "active",
        startDate: now.toISOString(),
        endDate: end,
      });
      noteChange(session, "updated", `sprint ${id}`);
      return started;
    },
  }),
  defineMethod({
    product: "jira",
    path: "sprints.close",
    risk: "external_write",
    options: ["id", "moveOpenTo"],
    signature: `/** Closes an active sprint. Open (not Done) issues stay in the closed sprint unless \`moveOpenTo\` names a sprint id or "backlog". */ close(options: { id: number; moveOpenTo?: number | "backlog" }): Promise<${SPRINT} & { moved: string[] }>`,
    parse: (options) => {
      const target = options.moveOpenTo;
      const moveOpenTo: number | "backlog" | undefined =
        target === undefined || target === "backlog"
          ? target
          : sprintId(target, "moveOpenTo");
      return { id: sprintId(options.id), moveOpenTo };
    },
    // Moving the open issues is part of closing: the destination sprint is a second target.
    authorize: ({ id, moveOpenTo }) => ({
      targets: [
        jiraSprint(id),
        ...(typeof moveOpenTo === "number" ? [jiraSprint(moveOpenTo)] : []),
      ],
      summary: `sprint ${id}`,
    }),
    resource: ({ id }) => `sprint ${id}`,
    async run({ id, moveOpenTo }, session) {
      const current = await getSprint(session, id);
      if (current.state !== "active") {
        throw new Error(
          `Sprint ${id} is ${String(current.state)}; only an active sprint can be closed.`,
        );
      }
      if (moveOpenTo === id) {
        throw new Error('moveOpenTo must be a different sprint or "backlog".');
      }
      const open =
        moveOpenTo === undefined
          ? []
          : (
              await sprintIssues(session, id, {
                jql: "statusCategory != Done",
                fields: ["summary"],
                limit: MAX_ISSUES,
              })
            ).map((raw) => String((raw as { key?: unknown }).key ?? ""));
      const closed = await putSprint(session, current, { state: "closed" });
      if (moveOpenTo !== undefined && open.length > 0) {
        await moveIssues(session, open, moveOpenTo);
      }
      noteChange(session, "updated", `sprint ${id}`);
      return { ...closed, moved: open };
    },
  }),
  defineMethod({
    product: "jira",
    path: "sprints.issues",
    risk: "network",
    bare: "id",
    options: ["id", "fields", "jql", "limit"],
    signature:
      "/** Like issues.search within the sprint; limit default 50, max 1000. */ issues(options: number | { id: number; fields?: string[]; jql?: string; limit?: number }): Promise<Issue[]>",
    parse: (options) => {
      const fields = options.fields;
      if (
        fields !== undefined &&
        (!Array.isArray(fields) ||
          fields.some((item) => typeof item !== "string"))
      ) {
        throw new Error("fields must be an array of field names or ids.");
      }
      return {
        id: sprintId(options.id),
        fields: fields as string[] | undefined,
        jql: optionalText(options.jql),
        limit: clampInt(options.limit, PAGE, 1, MAX_ISSUES),
      };
    },
    authorize: ({ id }) => ({
      targets: [jiraSprint(id)],
      summary: `sprint ${id}`,
    }),
    resource: ({ id }) => `sprint ${id}`,
    async run({ id, fields, jql, limit }, session) {
      const selection = fields
        ? await resolveFieldSelection(fields, () => session.fields())
        : defaultSelection(DEFAULT_SEARCH_FIELDS);
      const { siteUrl } = session.connection;
      const raw = await sprintIssues(session, id, {
        jql,
        fields: selection.map((field) => field.id),
        limit,
      });
      return raw.map((issue) => flattenIssue(issue, siteUrl, selection));
    },
  }),
  defineMethod({
    product: "jira",
    path: "sprints.delete",
    risk: "destructive",
    bare: "id",
    options: ["id"],
    signature:
      "/** Jira deletes future sprints only. */ delete(options: number | { id: number }): Promise<{ id: number }>",
    parse: (options) => sprintId(options.id),
    authorize: (id) => sprintAuthorization(id),
    resource: (id) => `sprint ${id}`,
    async run(id, session) {
      await jiraRequest(session.connection, {
        api: "agile",
        method: "DELETE",
        path: `/sprint/${pathSegment(String(id))}`,
      });
      noteChange(session, "deleted", `sprint ${id}`);
      return { id };
    },
  }),
];
