import { capturePhase5Trust, convertPhase5 } from "./phase5.js";
import { verifyPhase5 } from "./phase5-verification.js";
import { phaseProgress } from "./progress.js";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { defineStep, type StepContext } from "../../framework/step.js";
import { RollbackJournal } from "../../framework/rollback-journal.js";
import { finishPhase } from "../../framework/toolkit.js";
import { convertProfiles, json, safePath } from "./files.js";
import { profilesDocument } from "./profile-format.js";
import {
  convertDocument,
  convertEventPayload,
  convertFile,
  documentFiles,
} from "./documents.js";

function locations(ctx: StepContext) {
  safePath(ctx.paths.sqlitePath);
  const db = new DatabaseSync(ctx.paths.sqlitePath, { readOnly: true });
  try {
    return {
      projects: db
        .prepare("SELECT directory FROM project")
        .all()
        .map((row) => join(String(row.directory), ".nerve")),
      conversations: db
        .prepare("SELECT id FROM conversation")
        .all()
        .map((row) => String(row.id)),
    };
  } finally {
    db.close();
  }
}
function profilePath(path: string): string {
  return path.replace(/(^|\/)subagents(?=\/|\.json$)/g, "$1agent-profiles");
}

/** Keep 0001's v1 SQL boundary intact. This step edits data without opening core
 * storage; normal storage startup applies core v2 after all home steps finish.
 */
async function convertDatabase(ctx: StepContext): Promise<void> {
  await phaseProgress(ctx, "backup", "Backing up the database for rollback")();
  const journal = new RollbackJournal(ctx.scratchDir);
  // The home lock guarantees exclusive access. Checkpoint before snapshotting
  // the database, then close the last connection so no live WAL is copied.
  const checkpoint = new DatabaseSync(ctx.paths.sqlitePath);
  try {
    checkpoint.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  } finally {
    checkpoint.close();
  }
  for (const suffix of ["", "-wal", "-shm"])
    journal.preserveFile(ctx.paths.sqlitePath + suffix);
  await phaseProgress(ctx, "database", "Converting stored tool metadata")();
  const db = new DatabaseSync(ctx.paths.sqlitePath);
  try {
    db.exec("PRAGMA foreign_keys=ON; BEGIN IMMEDIATE");
    for (const row of db
      .prepare(
        "SELECT id, path FROM trusted_resource WHERE kind IN ('subagent_profile','agent_profile')",
      )
      .all()) {
      // Profile bytes and identity change: never carry old approval forward.
      db.prepare(
        "UPDATE trusted_resource SET path=?, status='rejected' WHERE id=?",
      ).run(profilePath(String(row.path)), row.id);
    }
    db.prepare(
      "UPDATE tool_call SET tool_name='plan_present' WHERE tool_name='plan_mode_present'",
    ).run();
    for (const row of db
      .prepare(
        "SELECT id, payload FROM conversation_event WHERE instr(payload, 'plan_mode_present') > 0",
      )
      .all()) {
      const before: unknown = JSON.parse(String(row.payload));
      const after = convertEventPayload(before);
      if (JSON.stringify(before) !== JSON.stringify(after))
        db.prepare("UPDATE conversation_event SET payload=? WHERE id=?").run(
          JSON.stringify(after),
          row.id,
        );
    }
    db.exec("COMMIT");
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
}

export default defineStep({
  id: "0002-agent-profiles",
  description: "Convert stored agent profiles and planning capabilities",
  async run(ctx) {
    const { projects, conversations } = locations(ctx);
    await phaseProgress(ctx, "trust", "Checking original project trust")();
    capturePhase5Trust(ctx, projects);
    const profileProgress = phaseProgress(
      ctx,
      "profile-documents",
      "Converting profile catalogs",
      projects.length + 1,
    );
    await profileProgress();
    let profilesDone = 0;
    for (const root of [ctx.paths.home, ...projects]) {
      const source = join(root, "config", "subagents.json");
      const target = join(root, "config", "agent-profiles.json");
      ctx.ownPaths([source, target], root);
      await ctx.unit(
        { kind: "configuration", id: target, title: "Agent profiles" },
        () => convertProfiles(ctx, root),
        { quarantine: { files: [source, target], root } },
      );
      await profileProgress(++profilesDone);
    }
    const files = documentFiles(ctx.paths.home, projects, conversations);
    const documentsProgress = phaseProgress(
      ctx,
      "documents",
      "Converting capability settings",
      files.length,
    );
    await documentsProgress();
    let documentsDone = 0;
    for (const file of files) {
      ctx.ownPaths([file.path], file.root);
      await ctx.unit(
        {
          kind: "configuration",
          id: file.path,
          title: `Agent profile settings: ${file.kind}`,
        },
        () => convertFile(ctx, file),
        { quarantine: { files: [file.path], root: file.root } },
      );
      await documentsProgress(++documentsDone);
    }
    // Do not update shared DB metadata if any document unit needs repair.
    finishPhase(ctx);
    await convertDatabase(ctx);
    await convertPhase5(ctx, projects, conversations);
  },
  async verify(ctx) {
    const { projects, conversations } = locations(ctx);
    for (const root of [ctx.paths.home, ...projects]) {
      const source = join(root, "config", "subagents.json");
      const target = join(root, "config", "agent-profiles.json");
      if (ctx.discarded.has(target)) continue;
      safePath(source);
      safePath(target);
      assert(!existsSync(source), `Legacy profile document remains: ${source}`);
      if (existsSync(target)) profilesDocument.parse(json(target));
    }
    for (const file of documentFiles(ctx.paths.home, projects, conversations)) {
      if (ctx.discarded.has(file.path) || !existsSync(file.path)) continue;
      const value = json(file.path);
      assert.deepEqual(
        convertDocument(value, file.kind),
        value,
        `Unconverted document: ${file.path}`,
      );
    }
    await verifyPhase5(ctx, projects, conversations);
    await phaseProgress(
      ctx,
      "verify-database",
      "Verifying stored tool metadata",
    )();
    const db = new DatabaseSync(ctx.paths.sqlitePath, { readOnly: true });
    try {
      assert.equal(
        db
          .prepare(
            "SELECT count(*) AS n FROM tool_call WHERE tool_name='plan_mode_present'",
          )
          .get()?.n,
        0,
      );
      for (const row of db
        .prepare(
          "SELECT payload FROM conversation_event WHERE instr(payload, 'plan_mode_present') > 0",
        )
        .all()) {
        const payload: unknown = JSON.parse(String(row.payload));
        assert.deepEqual(convertEventPayload(payload), payload);
      }
    } finally {
      db.close();
    }
  },
  async rollback(ctx) {
    new RollbackJournal(ctx.scratchDir).restore();
  },
});
