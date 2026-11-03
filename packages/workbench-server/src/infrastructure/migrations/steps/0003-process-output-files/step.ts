import { existsSync, readFileSync, statSync } from "node:fs";
import { join, posix } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createId } from "@nervekit/contracts";
import { defineStep, type StepContext } from "../../framework/step.js";

/**
 * Background commands now capture one `output.txt` with both streams in arrival order, and readers no longer
 * fall back to separate stream files. Runs recorded before that (converted by 0001 from the old task layout)
 * get an `output.txt` built from their ordered `combined.txt`, or from stdout followed by stderr.
 * Original files are kept: older transcripts may quote their paths.
 */

type Candidate = {
  asyncBashId: string;
  conversationId: string;
  toolCallId: string;
  directory: string;
  sources: Map<string, string>;
};

type Inserted = { assetIds: string[] };

const insertedPath = (context: StepContext) =>
  join(context.scratchDir, "inserted-assets.json");

function readInserted(context: StepContext): string[] {
  const path = insertedPath(context);
  return existsSync(path)
    ? (JSON.parse(readFileSync(path, "utf8")) as Inserted).assetIds
    : [];
}

/** One scan of background-run assets (`asset.async_bash_id` is not indexed); grouping happens here. */
function candidates(database: DatabaseSync): Candidate[] {
  const rows = database
    .prepare(
      `SELECT a.async_bash_id, b.conversation_id, b.tool_call_id, a.logical_path
       FROM asset a JOIN async_bash b ON b.id = a.async_bash_id
       WHERE a.async_bash_id IS NOT NULL`,
    )
    .all() as {
    async_bash_id: string;
    conversation_id: string;
    tool_call_id: string;
    logical_path: string;
  }[];
  const byId = new Map<string, Candidate>();
  for (const row of rows) {
    const candidate = byId.get(row.async_bash_id) ?? {
      asyncBashId: row.async_bash_id,
      conversationId: row.conversation_id,
      toolCallId: row.tool_call_id,
      directory: posix.dirname(row.logical_path),
      sources: new Map<string, string>(),
    };
    candidate.sources.set(posix.basename(row.logical_path), row.logical_path);
    byId.set(row.async_bash_id, candidate);
  }
  return [...byId.values()]
    .filter(
      (candidate) =>
        !candidate.sources.has("output.txt") &&
        (candidate.sources.has("combined.txt") ||
          candidate.sources.has("stdout.txt") ||
          candidate.sources.has("stderr.txt")),
    )
    .sort((a, b) => a.asyncBashId.localeCompare(b.asyncBashId));
}

function open(context: StepContext, readOnly: boolean): DatabaseSync {
  return new DatabaseSync(context.paths.sqlitePath, { readOnly });
}

function target(context: StepContext, candidate: Candidate): string {
  return join(context.paths.dataPath, candidate.directory, "output.txt");
}

function outputBytes(context: StepContext, candidate: Candidate): Buffer {
  const read = (name: string) => {
    const logical = candidate.sources.get(name);
    const path = logical && join(context.paths.dataPath, logical);
    return path && existsSync(path) ? readFileSync(path) : Buffer.alloc(0);
  };
  // `combined.txt` already holds both streams in arrival order, labelled by stream.
  if (candidate.sources.has("combined.txt")) return read("combined.txt");
  return Buffer.concat([read("stdout.txt"), read("stderr.txt")]);
}

export default defineStep({
  id: "0003-process-output-files",
  description: "Give every background command a single output file",
  ownedPaths(context) {
    if (!existsSync(context.paths.sqlitePath)) return [];
    const database = open(context, true);
    try {
      return candidates(database).map((candidate) =>
        target(context, candidate),
      );
    } finally {
      database.close();
    }
  },
  async run(context) {
    if (!existsSync(context.paths.sqlitePath)) return;
    const database = open(context, false);
    try {
      const pending = candidates(database);
      context.progress("run", 0, pending.length, "Writing output files");
      const rows = pending.map((candidate) => {
        const path = target(context, candidate);
        context.fs.write(path, outputBytes(context, candidate));
        return { candidate, path, id: createId("asset") };
      });
      // Record IDs before inserting, keeping earlier attempts', so a failed step can be rolled back.
      context.fs.write(
        insertedPath(context),
        JSON.stringify({
          assetIds: [...readInserted(context), ...rows.map((row) => row.id)],
        } satisfies Inserted),
      );
      const insert = database.prepare(
        `INSERT INTO asset (id, conversation_id, event_id, tool_call_id, async_bash_id, category,
           logical_path, digest, byte_length, media_type, created_at)
         VALUES (?, ?, NULL, ?, ?, 'bash_output', ?, NULL, ?, NULL, ?)`,
      );
      const now = new Date().toISOString();
      database.exec("BEGIN IMMEDIATE");
      try {
        for (const { candidate, path, id } of rows)
          insert.run(
            id,
            candidate.conversationId,
            candidate.toolCallId,
            candidate.asyncBashId,
            posix.join(candidate.directory, "output.txt"),
            statSync(path).size,
            now,
          );
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
      context.progress("run", rows.length, rows.length);
      context.log(`Created output files for ${rows.length} background runs`);
    } finally {
      database.close();
    }
  },
  async verify(context) {
    if (!existsSync(context.paths.sqlitePath)) return;
    const database = open(context, true);
    try {
      const missing = candidates(database).length;
      if (missing > 0)
        throw new Error(`${missing} background runs still have no output file`);
      const assetIds = readInserted(context);
      const lookup = database.prepare(
        "SELECT logical_path, byte_length FROM asset WHERE id = ?",
      );
      for (const id of assetIds) {
        const row = lookup.get(id) as
          | { logical_path: string; byte_length: number }
          | undefined;
        const file = row && join(context.paths.dataPath, row.logical_path);
        if (
          !file ||
          !existsSync(file) ||
          statSync(file).size !== row.byte_length
        )
          throw new Error(
            `Missing or changed background output file for ${id}`,
          );
      }
    } finally {
      database.close();
    }
  },
  async rollback(context) {
    const assetIds = readInserted(context);
    if (!assetIds.length || !existsSync(context.paths.sqlitePath)) return;
    const database = open(context, false);
    try {
      const remove = database.prepare("DELETE FROM asset WHERE id = ?");
      database.exec("BEGIN IMMEDIATE");
      for (const id of assetIds) remove.run(id);
      database.exec("COMMIT");
    } finally {
      database.close();
    }
  },
});
