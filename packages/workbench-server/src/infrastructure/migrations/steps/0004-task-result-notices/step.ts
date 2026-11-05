import { existsSync, readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { defineStep, type StepContext } from "../../framework/step.js";

/**
 * Background-task completions used to be two system notices, `async_bash_event` and
 * `sub_conversation_event`. They are now one `task_result` notice. This step rewrites the stored events
 * and still-queued inputs. The shapes are frozen copies; migration steps must not import live contracts.
 * The rewrite is a lossless field mapping (`lost` becomes `interrupted`), so `rollback` applies the
 * inverse mapping to the rows this step rewrote (their IDs are kept in scratch).
 */

type Json = Record<string, unknown>;
type Rewritten = { events: string[]; inputs: string[] };

const OLD_SUBTYPES = ["async_bash_event", "sub_conversation_event"] as const;
const OLD_BASH_STATUSES = [
  "completed",
  "failed",
  "timed_out",
  "cancelled",
  "lost",
];
const OLD_SUBAGENT_STATUSES = [
  "completed",
  "failed",
  "cancelled",
  "interrupted",
];

const isRecord = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function text(source: Json, key: string): string {
  const value = source[key];
  if (typeof value !== "string") throw new Error(`Notice field ${key} invalid`);
  return value;
}

/** Validated copy of a released notice, limited to the fields of its frozen shape. */
function legacyNotice(old: Json): Json {
  const assetIds = old.assetIds;
  if (!Array.isArray(assetIds) || assetIds.some((id) => typeof id !== "string"))
    throw new Error("Notice field assetIds invalid");
  const common = { subtype: old.subtype, producer: text(old, "producer") };
  const tail = { text: text(old, "text"), assetIds };
  if (old.subtype === "async_bash_event") {
    const exitCode = old.exitCode ?? null;
    if (exitCode !== null && !Number.isInteger(exitCode))
      throw new Error("Notice field exitCode invalid");
    const status = text(old, "status");
    if (!OLD_BASH_STATUSES.includes(status))
      throw new Error("Notice field status invalid");
    return {
      ...common,
      bashId: text(old, "bashId"),
      status,
      exitCode,
      ...tail,
    };
  }
  const status = text(old, "status");
  if (!OLD_SUBAGENT_STATUSES.includes(status))
    throw new Error("Notice field status invalid");
  return {
    ...common,
    childConversationId: text(old, "childConversationId"),
    assignmentId: text(old, "assignmentId"),
    status,
    ...tail,
  };
}

function toTaskResult(legacy: Json): Json {
  const outcome = legacy.status === "lost" ? "interrupted" : legacy.status;
  const task =
    legacy.subtype === "async_bash_event"
      ? { kind: "bash", id: legacy.bashId, exitCode: legacy.exitCode }
      : {
          kind: "subagent",
          id: legacy.childConversationId,
          assignmentId: legacy.assignmentId,
        };
  return {
    subtype: "task_result",
    producer: legacy.producer,
    task,
    outcome,
    text: legacy.text,
    assetIds: legacy.assetIds,
  };
}

/** Inverse of `toTaskResult`; `undefined` when the value is not a `task_result` notice. */
function toLegacy(next: unknown): Json | undefined {
  if (!isRecord(next) || next.subtype !== "task_result") return undefined;
  const task = next.task as Json;
  const tail = { text: next.text, assetIds: next.assetIds };
  if (task.kind === "bash")
    return {
      subtype: "async_bash_event",
      producer: next.producer,
      bashId: task.id,
      status: next.outcome === "interrupted" ? "lost" : next.outcome,
      exitCode: task.exitCode ?? null,
      ...tail,
    };
  return {
    subtype: "sub_conversation_event",
    producer: next.producer,
    childConversationId: task.id,
    assignmentId: task.assignmentId,
    status: next.outcome,
    ...tail,
  };
}

const placeholder = (): Json => ({
  subtype: "notification",
  producer: "migration",
  text: "A background task result could not be upgraded and was set aside.",
});

const rewrittenPath = (context: StepContext) =>
  join(context.scratchDir, "rewritten-notices.json");

function readRewritten(context: StepContext): Rewritten {
  const path = rewrittenPath(context);
  return existsSync(path)
    ? (JSON.parse(readFileSync(path, "utf8")) as Rewritten)
    : { events: [], inputs: [] };
}

type NoticeRow = {
  table: "conversation_event" | "input_queue";
  id: string;
  raw: string;
};

const OLD_SQL = OLD_SUBTYPES.map((subtype) => `'${subtype}'`).join(", ");

function oldNotices(
  database: DatabaseSync,
  conversationId: string,
): NoticeRow[] {
  const events = database
    .prepare(
      `SELECT id, payload AS raw FROM conversation_event
       WHERE conversation_id = ? AND event_type = 'system_event'
         AND json_extract(payload, '$.subtype') IN (${OLD_SQL}) ORDER BY sequence`,
    )
    .all(conversationId) as Array<{ id: string; raw: string }>;
  const inputs = database
    .prepare(
      `SELECT input_id AS id, content AS raw FROM input_queue
       WHERE conversation_id = ? AND source = 'system'
         AND json_extract(content, '$.subtype') IN (${OLD_SQL}) ORDER BY acceptance_sequence`,
    )
    .all(conversationId) as Array<{ id: string; raw: string }>;
  return [
    ...events.map((row) => ({ table: "conversation_event" as const, ...row })),
    ...inputs.map((row) => ({ table: "input_queue" as const, ...row })),
  ];
}

function pendingNoticeConversations(database: DatabaseSync): string[] {
  const rows = database
    .prepare(
      `SELECT conversation_id AS id FROM conversation_event
         WHERE event_type = 'system_event' AND json_extract(payload, '$.subtype') IN (${OLD_SQL})
       UNION SELECT conversation_id FROM input_queue
         WHERE source = 'system' AND json_extract(content, '$.subtype') IN (${OLD_SQL})
       ORDER BY 1`,
    )
    .all() as Array<{ id: string }>;
  return rows.map((row) => row.id);
}

const write = (database: DatabaseSync, row: NoticeRow, value: Json) =>
  database
    .prepare(
      row.table === "conversation_event"
        ? "UPDATE conversation_event SET payload = ? WHERE id = ?"
        : "UPDATE input_queue SET content = ? WHERE input_id = ?",
    )
    .run(JSON.stringify(value), row.id);

const read = (database: DatabaseSync, row: NoticeRow): unknown => {
  const found = database
    .prepare(
      row.table === "conversation_event"
        ? "SELECT payload AS raw FROM conversation_event WHERE id = ?"
        : "SELECT content AS raw FROM input_queue WHERE input_id = ?",
    )
    .get(row.id) as { raw: string } | undefined;
  return found && JSON.parse(found.raw);
};

/**
 * Rewrites one conversation's old notices inside the caller's transaction and verifies each rewritten
 * row (its inverse must equal the validated original) before the caller commits. With `lenient`
 * (the user chose to set the conversation aside) a malformed event becomes a plain notification and a
 * malformed queued input is dropped; the originals are archived by the caller.
 */
function rewriteNotices(
  database: DatabaseSync,
  rows: NoticeRow[],
  lenient: boolean,
): void {
  for (const row of rows) {
    let legacy: Json;
    try {
      const parsed: unknown = JSON.parse(row.raw);
      if (!isRecord(parsed)) throw new Error("Notice is not an object");
      legacy = legacyNotice(parsed);
    } catch (error) {
      if (!lenient) throw error;
      if (row.table === "conversation_event")
        write(database, row, placeholder());
      else
        database
          .prepare("DELETE FROM input_queue WHERE input_id = ?")
          .run(row.id);
      continue;
    }
    write(database, row, toTaskResult(legacy));
    if (!isDeepStrictEqual(toLegacy(read(database, row)), legacy))
      throw new Error(`Rewritten notice ${row.id} does not match its original`);
  }
}

function inTransaction(database: DatabaseSync, action: () => void): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    action();
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

async function rewriteAllNotices(
  context: StepContext,
  database: DatabaseSync,
): Promise<number> {
  const conversations = pendingNoticeConversations(database);
  context.progress("run", 0, conversations.length, "Upgrading task notices");
  const tracked = readRewritten(context);
  let done = 0;
  for (const id of conversations) {
    const rows = oldNotices(database, id);
    // Track before writing, keeping earlier attempts'; inverse mapping ignores rows never rewritten.
    const ids = (table: NoticeRow["table"], list: string[]) => [
      ...new Set([
        ...list,
        ...rows.filter((r) => r.table === table).map((r) => r.id),
      ]),
    ];
    tracked.events = ids("conversation_event", tracked.events);
    tracked.inputs = ids("input_queue", tracked.inputs);
    context.fs.write(rewrittenPath(context), JSON.stringify(tracked));
    const title = (
      database
        .prepare("SELECT title FROM conversation WHERE id = ?")
        .get(id) as { title: string } | undefined
    )?.title;
    const item = { kind: "conversation" as const, id, title };
    if (context.discarded.has(id)) {
      // Archive the originals, then keep the conversation usable with neutralized notices.
      context.quarantine(
        {
          ...item,
          reason: "Set aside at user request after an upgrade failure",
        },
        {
          records: rows.map((row) => ({
            table: row.table,
            id: row.id,
            content: row.raw,
          })),
        },
      );
      inTransaction(database, () => rewriteNotices(database, rows, true));
    } else
      await context.unit(item, () => rewriteNotices(database, rows, false), {
        transaction: async (action) => {
          database.exec("BEGIN IMMEDIATE");
          try {
            const value = await action();
            database.exec("COMMIT");
            return value;
          } catch (error) {
            database.exec("ROLLBACK");
            throw error;
          }
        },
      });
    context.progress("run", ++done, conversations.length);
  }
  return conversations.length;
}

function restoreNotices(context: StepContext, database: DatabaseSync): void {
  const { events, inputs } = readRewritten(context);
  const restore = (table: NoticeRow["table"], ids: string[]): void => {
    for (const id of ids) {
      const row = { table, id, raw: "" };
      const legacy = toLegacy(read(database, row));
      if (legacy) write(database, row, legacy);
    }
  };
  inTransaction(database, () => {
    restore("conversation_event", events);
    restore("input_queue", inputs);
  });
}

function open(context: StepContext, readOnly: boolean): DatabaseSync {
  return new DatabaseSync(context.paths.sqlitePath, { readOnly });
}

export default defineStep({
  id: "0004-task-result-notices",
  description: "Unify background task result notices",
  async run(context) {
    if (!existsSync(context.paths.sqlitePath)) return;
    const database = open(context, false);
    try {
      const upgraded = await rewriteAllNotices(context, database);
      context.log(`Upgraded task notices in ${upgraded} conversations`);
    } finally {
      database.close();
    }
  },
  async verify(context) {
    if (!existsSync(context.paths.sqlitePath)) return;
    const database = open(context, true);
    try {
      const stale = pendingNoticeConversations(database).length;
      if (stale > 0)
        throw new Error(`${stale} conversations still have old task notices`);
    } finally {
      database.close();
    }
  },
  async rollback(context) {
    if (!existsSync(context.paths.sqlitePath)) return;
    const database = open(context, false);
    try {
      restoreNotices(context, database);
    } finally {
      database.close();
    }
  },
});
