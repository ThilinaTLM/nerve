import { includeFailures, replaceLosses } from "../../framework/toolkit.js";
import { quarantineDiscardedConversations } from "./quarantine.js";
import { HOME_CONFIGURATION_FILES } from "./owned-paths.js";
import { assertProjectedPayload } from "./result-projection.js";
import { setImmediate } from "node:timers/promises";
import { rm } from "node:fs/promises";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statfsSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import {
  DiscardableMigrationError,
  defineStep,
  type DiscardableItem,
  type StepContext,
} from "../../framework/step.js";
import {
  failureReason,
  importCoreStorage,
  type CoreImportSummary,
} from "./importer.service.js";
import {
  RollbackJournal,
  withRollbackJournal,
} from "../../framework/rollback-journal.js";
import {
  checkConfiguration,
  preflightConfiguration,
  resetPreflight,
} from "./config-preflight.js";
import {
  atomicWrite,
  convertConfiguration,
  readJson,
  writeJson,
} from "./configuration.js";
import {
  captureLegacyProfileEnablement,
  convertProfileScope,
  profileReceiptPath,
  convertSubagentSettings,
} from "./subagent-profiles.js";
import { profilesDocument } from "./subagent-profile-format.js";
import { LegacyReader, type Legacy } from "./legacy.reader.js";
import { CoreStorage } from "./storage.js";
import { coreSchemaV1 } from "./schema.js";
import {
  verifySelectedPath,
  type SelectedPathVerification,
} from "./selected-path.validation.js";

const checkedConfiguration = new WeakMap<
  StepContext,
  Awaited<ReturnType<typeof checkConfiguration>>
>();

const suffixes = ["", "-wal", "-shm"];
const summaryPath = (ctx: StepContext) =>
  join(ctx.scratchDir, "import-summary.json");
const verifiedPath = (ctx: StepContext) =>
  join(ctx.scratchDir, "verified.json");
const sourcePath = (ctx: StepContext) => `${ctx.paths.sqlitePath}.migrating`;

async function preserveBashOutputs(ctx: StepContext): Promise<void> {
  const storage = new CoreStorage(ctx.paths.sqlitePath, false);
  try {
    for (const row of storage.sqlite
      .prepare(
        "SELECT id, conversation_id, async_bash_id, logical_path FROM asset WHERE logical_path LIKE 'tasks/%'",
      )
      .iterate()) {
      await setImmediate();
      const old = join(ctx.paths.dataPath, String(row.logical_path));
      assert(
        !String(row.logical_path).split("/").includes(".."),
        "Unsafe task output path",
      );
      const logical = `conversations/${row.conversation_id}/async-bash/${row.async_bash_id ?? row.id}/${basename(old)}`;
      const destination = join(ctx.paths.dataPath, logical);
      if (existsSync(old)) {
        assert(lstatSync(old).isFile());
        mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
        const temporary = `${destination}.migrating`;
        try {
          copyFileSync(old, temporary);
          renameSync(temporary, destination);
        } finally {
          rmSync(temporary, { force: true });
        }
      }
      storage.sqlite
        .prepare("UPDATE asset SET logical_path = ? WHERE id = ?")
        .run(logical, row.id);
    }
  } finally {
    storage.close();
  }
}
interface CheckResult {
  selected: SelectedPathVerification;
  /** Conversations that failed verification, keyed by source conversation. */
  failures: DiscardableItem[];
}

async function check(
  ctx: StepContext,
  summary: CoreImportSummary,
): Promise<CheckResult> {
  const storage = new CoreStorage(ctx.paths.sqlitePath, false);
  const selected: SelectedPathVerification = {
    roots: 0,
    children: 0,
    userMessageMismatches: [],
    headMismatches: [],
    unansweredToolCalls: 0,
    duplicateToolResults: 0,
    orphanToolResults: 0,
  };
  // Per-conversation checks record a failure for the source conversation and
  // continue; only home-wide checks still abort verification.
  const failures = new Map<string, string>();
  const sourceOf = new Map<string, string>();
  for (const path of summary.paths)
    sourceOf.set(path.conversationId, path.label.split("/")[0]);
  const fail = (conversationId: string, reason: string) => {
    const source = sourceOf.get(conversationId) ?? conversationId;
    if (!failures.has(source)) failures.set(source, reason);
  };
  const excluded = new Set(summary.excludedConversations);
  const titles = new Map(Object.entries(summary.titles ?? {}));
  try {
    const schema = storage.sqlite
      .prepare("SELECT version, checksum FROM schema_migrations")
      .all();
    assert.equal(schema.length, 1);
    assert.equal(schema[0].version, 1);
    assert.equal(
      schema[0].checksum,
      createHash("sha256").update(coreSchemaV1).digest("hex"),
      "Core schema checksum mismatch",
    );
    for (const path of summary.paths) {
      await setImmediate();
      if (path.isRoot) selected.roots++;
      else selected.children++;
      const one: SelectedPathVerification = {
        roots: 0,
        children: 0,
        userMessageMismatches: [],
        headMismatches: [],
        unansweredToolCalls: 0,
        duplicateToolResults: 0,
        orphanToolResults: 0,
      };
      try {
        verifySelectedPath({ ...path, storage, summary: one });
      } catch (error) {
        fail(path.conversationId, failureReason(error));
        continue;
      }
      selected.userMessageMismatches.push(...one.userMessageMismatches);
      selected.headMismatches.push(...one.headMismatches);
      selected.unansweredToolCalls += one.unansweredToolCalls;
      selected.duplicateToolResults += one.duplicateToolResults;
      selected.orphanToolResults += one.orphanToolResults;
      const problems = [
        one.userMessageMismatches.length && "user messages differ",
        one.headMismatches.length && "selected branch differs",
        one.unansweredToolCalls && "unanswered tool calls",
        one.duplicateToolResults && "duplicate tool results",
        one.orphanToolResults && "orphan tool results",
      ].filter(Boolean);
      if (problems.length)
        fail(
          path.conversationId,
          `History verification failed: ${problems.join(", ")}`,
        );
    }
    for (const receipt of summary.salvagedRecords ?? []) {
      try {
        const event = storage.events.get(receipt.eventId);
        assert(
          event?.type === "system_event" &&
            event.llmRepresentation === "none" &&
            event.payload.subtype === "notification" &&
            event.payload.producer === "import:migration_loss",
          `Missing history-loss placeholder for ${receipt.sourceRecordId}`,
        );
        assert.equal(
          createHash("sha256").update(event.payload.text).digest("hex"),
          receipt.textDigest,
          `Changed history-loss placeholder for ${receipt.sourceRecordId}`,
        );
      } catch (error) {
        fail(receipt.conversationId, failureReason(error));
      }
    }
    for (const [table, expected] of Object.entries(summary.counts)) {
      assert(/^[a-z_]+$/.test(table));
      assert.equal(
        Number(
          storage.sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n,
        ),
        expected,
        `Row count changed: ${table}`,
      );
    }
    assert.equal(
      storage.sqlite.prepare("PRAGMA foreign_key_check").all().length,
      0,
      "Foreign-key failures",
    );
    assert.equal(
      storage.sqlite.prepare("PRAGMA quick_check").get()!.quick_check,
      "ok",
      "Integrity failure",
    );
    let payloadCount = 0,
      payloadTotal = 0,
      payloadMax = 0,
      responseCount = 0,
      responseTotal = 0,
      responseMax = 0;
    for (const row of storage.sqlite
      .prepare(
        "SELECT conversation_id, event_type AS type, payload FROM conversation_event",
      )
      .iterate()) {
      if (payloadCount % 100 === 0) await setImmediate();
      const conversationId = String(row.conversation_id);
      if (failures.has(sourceOf.get(conversationId) ?? conversationId))
        continue;
      try {
        const text = String(row.payload),
          payload = JSON.parse(text),
          bytes = Buffer.byteLength(text);
        assertProjectedPayload(payload);
        payloadCount++;
        payloadTotal += bytes;
        payloadMax = Math.max(payloadMax, bytes);
        if (row.type === "tool_call_response") {
          assert(
            !("result" in payload) && !("modelContent" in payload),
            "Inline complete result in event",
          );
          assert(
            Array.isArray(payload.agentProjection) && payload.userProjection,
            "Missing projections",
          );
          const assets = payload.assetIds.map((id: string) =>
            storage.assets.get(id),
          );
          assert(assets.every(Boolean), "Missing response asset row");
          const result = assets.find(
            (asset: Legacy) =>
              asset.category === "payload" &&
              asset.logicalPath.endsWith("/result.json"),
          );
          assert(result, "Missing complete result asset");
          const complete = readJson(
            join(ctx.paths.dataPath, result.logicalPath),
          );
          assertProjectedPayload(complete);
          const refs = (value: unknown): void => {
            if (!value || typeof value !== "object") return;
            if (Array.isArray(value)) {
              value.forEach(refs);
              return;
            }
            const record = value as Legacy;
            if (record.type === "image")
              assert(
                assets.some(
                  (asset: Legacy) =>
                    asset.id === record.assetId && asset.category === "image",
                ),
                "Untracked image reference",
              );
            Object.values(record).forEach(refs);
          };
          refs(payload.agentProjection);
          refs(payload.userProjection);
          refs(complete);
          responseCount++;
          responseTotal += bytes;
          responseMax = Math.max(responseMax, bytes);
        }
      } catch (error) {
        fail(conversationId, `Invalid event: ${failureReason(error)}`);
      }
    }
    ctx.log(
      `Payload bytes: ${JSON.stringify({ events: { count: payloadCount, max: payloadMax, avg: payloadCount ? payloadTotal / payloadCount : 0 }, toolResponses: { count: responseCount, max: responseMax, avg: responseCount ? responseTotal / responseCount : 0 } })}`,
    );
    const paths = new Set<string>(),
      missing = new Set(summary.assets.missingAssetIds);
    for (const row of storage.sqlite
      .prepare(
        "SELECT id, conversation_id, logical_path, byte_length FROM asset",
      )
      .iterate()) {
      if (paths.size % 100 === 0) await setImmediate();
      const logical = String(row.logical_path);
      assert(!logical.startsWith("/") && !logical.split("/").includes(".."));
      paths.add(logical);
      try {
        const path = join(ctx.paths.dataPath, logical);
        if (!existsSync(path))
          assert(
            missing.has(String(row.id)),
            `Newly missing asset: ${logical}`,
          );
        else {
          assert(lstatSync(path).isFile());
          assert.equal(
            lstatSync(path).size,
            Number(row.byte_length),
            `Asset size changed: ${logical}`,
          );
        }
      } catch (error) {
        fail(String(row.conversation_id), failureReason(error));
      }
    }
    assert.equal(
      paths.size,
      summary.assets.trackedFiles,
      "Asset coverage changed",
    );
    // Import receipts cover source history and asset enumeration; verify only
    // replacement data, without decoding or walking retained sources again.
    for (const receipt of summary.assets.sourceFiles) {
      const logical =
        summary.assets.relocatedPayloads[receipt.logicalPath] ??
        receipt.logicalPath;
      if (!paths.has(logical))
        fail(
          receipt.conversationId,
          `Untracked source asset: ${receipt.logicalPath}`,
        );
    }
    assert.equal(
      summary.assets.sourceFiles.length,
      summary.assets.diskFiles,
      "Source asset receipt coverage changed",
    );
    assert.equal(
      selected.roots + excluded.size,
      summary.sourceConversationCount,
      "Source conversation receipt coverage changed",
    );
    assert.equal(
      selected.roots + selected.children,
      summary.counts.conversation,
    );
    return {
      selected,
      failures: [...failures].map(([id, reason]) => ({
        kind: "conversation" as const,
        id,
        title: titles.get(id),
        reason,
      })),
    };
  } finally {
    storage.close();
  }
}
async function cleanup(
  ctx: StepContext,
  summary: CoreImportSummary,
): Promise<void> {
  // Set-aside source directories were moved to permanent quarantine before
  // cleanup; never recursively delete an excluded owner's only source.
  for (const logical of Object.keys(summary.assets.relocatedPayloads)) {
    assert(!isAbsolute(logical) && !logical.split(/[\\/]/).includes(".."));
    await rm(join(ctx.paths.dataPath, logical), { force: true });
  }
  // All referenced task outputs have verified replacements in conversation storage.
  for (const path of [
    join(ctx.paths.dataPath, "tasks"),
    // Reports were copied into their child conversations during import.
    join(ctx.paths.dataPath, "reports"),
    ctx.paths.queryCachePath,
    `${ctx.paths.queryCachePath}-wal`,
    `${ctx.paths.queryCachePath}-shm`,
    join(ctx.paths.home, "journal"),
    join(ctx.paths.dataPath, "journal"),
    join(ctx.paths.dataPath, "state.sqlite"),
    join(ctx.paths.dataPath, "core.sqlite"),
  ]) {
    await rm(path, { recursive: true, force: true });
  }
  for (const name of readdirSync(ctx.paths.migrationsPath)) {
    if (!["work", "last-failure.json", "reports"].includes(name))
      await rm(join(ctx.paths.migrationsPath, name), {
        recursive: true,
        force: true,
      });
  }
  for (const path of [
    join(ctx.paths.dataPath, "migrations"),
    join(ctx.paths.home, "migration-journal.json"),
  ])
    await rm(path, { recursive: true, force: true });
  // Source is last: a crash during cleanup is resumed from the verified checkpoint.
  for (const suffix of ["-wal", "-shm", ""])
    await rm(`${sourcePath(ctx)}${suffix}`, { force: true });
}

async function convert(
  ctx: StepContext,
  journal: RollbackJournal,
): Promise<void> {
  ctx.progress(
    "rename-source",
    undefined,
    undefined,
    "Preparing the source database",
  );
  await setImmediate();
  const source = sourcePath(ctx),
    original = ctx.paths.sqlitePath;
  const old = existsSync(source) ? source : original;
  assert(lstatSync(old).isFile(), "Migration database must be a regular file");
  const disk = statfsSync(ctx.paths.home, { bigint: true });
  assert(
    disk.bavail * disk.bsize >= BigInt(Math.ceil(lstatSync(old).size * 0.15)),
    "Insufficient disk space for the new database (15% of legacy size)",
  );
  if (!existsSync(source)) {
    // Sidecars first: once the main rename is visible, original sidecars can
    // only belong to a partial new DB, even after an interrupted rename.
    for (const suffix of ["-wal", "-shm", ""])
      if (existsSync(`${original}${suffix}`)) {
        assert(lstatSync(`${original}${suffix}`).isFile());
        assert(
          !existsSync(`${source}${suffix}`),
          `Conflicting migration sidecar ${suffix}`,
        );
        renameSync(`${original}${suffix}`, `${source}${suffix}`);
      }
  }
  const sourceReader = new LegacyReader(source, ctx);
  try {
    for (const table of [
      "domain_documents",
      "conversation_records",
      "agent_context_leaves",
      "file_assets",
    ])
      assert(
        sourceReader.hasTable(table),
        `Not a 0.34.1 source: missing ${table}`,
      );
  } finally {
    sourceReader.close();
  }
  for (const suffix of suffixes)
    rmSync(`${original}${suffix}`, { force: true });
  ctx.progress(
    "check-configuration",
    undefined,
    undefined,
    "Checking configuration files",
  );
  await setImmediate();
  let invalid: DiscardableItem[];
  const checked = checkedConfiguration.get(ctx);
  if (checked) {
    invalid = checked.failures;
    if (!invalid.length) checked.apply(journal, (message) => ctx.log(message));
  } else {
    const preflightReader = new LegacyReader(source, ctx);
    try {
      invalid = await preflightConfiguration({
        home: ctx.paths.home,
        context: ctx,
        dataDir: ctx.paths.dataPath,
        reader: preflightReader,
        discarded: ctx.discarded,
        journal,
        log: (message) => ctx.log(message),
      });
    } finally {
      preflightReader.close();
    }
  }
  // Nothing is converted yet: report every unreadable file at once.
  if (invalid.length) throw new DiscardableMigrationError(invalid);
  ctx.progress(
    "configuration",
    undefined,
    undefined,
    "Upgrading configuration",
  );
  await setImmediate();
  const legacyEnabled = captureLegacyProfileEnablement(
    ctx.paths.home,
    ctx.scratchDir,
  );
  const profileTarget = join(ctx.paths.home, "config", "subagents.json");
  const conversions = {
    ...(await convertConfiguration(ctx.paths.home, ctx.scratchDir, ctx)),
    subagentSettings: await ctx.unit(
      {
        kind: "configuration",
        id: profileTarget,
        title: "User sub-agent profiles",
      },
      () => convertSubagentSettings(ctx.paths.home, ctx.scratchDir),
      {
        quarantine: {
          files: [profileTarget, join(ctx.paths.home, "agent", "subagents")],
        },
      },
    ),
  };
  ctx.log(`Configuration conversions: ${JSON.stringify(conversions)}`);
  const reader = new LegacyReader(source, ctx);
  let total: number;
  try {
    total = Number(
      reader.db
        .prepare(
          "SELECT count(*) AS n FROM domain_documents WHERE namespace = 'conversation'",
        )
        .get()!.n,
    );
  } finally {
    reader.close();
  }
  let done = 0;
  ctx.progress("import", 0, total, "Importing conversations");
  await setImmediate();
  // New-layout conversation directories are removed again on rollback.
  journal.snapshotDirectory(ctx.paths.conversationsPath);
  const summary = await importCoreStorage({
    home: ctx.paths.home,
    context: ctx,
    scratchDir: ctx.scratchDir,
    discarded: ctx.discarded,
    progress: () =>
      ctx.progress("import", ++done, total, "Importing conversations"),
  });
  const userProfiles = profilesDocument.parse(
    readJson(join(ctx.paths.home, "config", "subagents.json"), {
      schemaVersion: 1,
      profiles: {},
    }),
  ).profiles;
  const projectStorage = new CoreStorage(ctx.paths.sqlitePath, false);
  try {
    for (const row of projectStorage.sqlite
      .prepare("SELECT directory FROM project")
      .all()) {
      const root = join(String(row.directory), ".nerve");
      const target = join(root, "config", "subagents.json");
      await ctx.unit(
        {
          kind: "configuration",
          id: target,
          title: "Project sub-agent profiles",
        },
        () =>
          convertProfileScope(root, join(root, "subagents"), [], false, {
            legacyEnabled,
            inheritedProfiles: userProfiles,
            receiptPath: profileReceiptPath(ctx.scratchDir, root),
          }),
        {
          quarantine: {
            files: [target, join(root, "subagents")],
            root: String(row.directory),
          },
        },
      );
    }
  } finally {
    projectStorage.close();
  }
  ctx.progress(
    "preserve-task-outputs",
    undefined,
    undefined,
    "Preserving task outputs",
  );
  await setImmediate();
  await preserveBashOutputs(ctx);
  const launches = join(ctx.paths.dataPath, "launches");
  if (existsSync(launches))
    for (const entry of readdirSync(launches, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith("task_")) continue;
      const target = join(launches, entry.name.replace(/^task_/, "launch_"));
      if (existsSync(target)) {
        ctx.log(`Launch log collision at ${target}; keeping both directories`);
        continue;
      }
      journal.recordRename(join(launches, entry.name), target);
      renameSync(join(launches, entry.name), target);
    }
  writeJson(summaryPath(ctx), summary);
  ctx.log(
    `Imported: ${JSON.stringify({ counts: summary.counts, overlays: summary.overlays, preferences: summary.preferences, assets: summary.assets, losses: summary.lossyMappings, skipped: summary.skipped })}`,
  );
}

/**
 * A completed attempt whose only failures were import failures already holds
 * exactly the database a rerun without them would build: each failed
 * conversation's transaction, files and report entries were rolled back. Once
 * the user discards all of them, verification can run again directly.
 * Conversations that failed verification exist in the database, so
 * discarding any of them (or retrying without discards) re-imports.
 */
function reusePreviousImport(ctx: StepContext): boolean {
  if (!existsSync(summaryPath(ctx)) || !existsSync(sourcePath(ctx)))
    return false;
  const summary = readJson(summaryPath(ctx)) as CoreImportSummary;
  const excluded = new Set(summary.excludedConversations);
  // Configuration items are absolute paths; they were settled before import.
  const conversations = [...ctx.discarded].filter((id) => !isAbsolute(id));
  if (
    !summary.failedConversations.length ||
    !summary.failedConversations.every(({ id }) => ctx.discarded.has(id)) ||
    !conversations.every((id) => excluded.has(id))
  )
    return false;
  writeJson(summaryPath(ctx), { ...summary, failedConversations: [] });
  return true;
}

export default defineStep({
  id: "0001-conversation-core",
  description:
    "Convert the 0.34.1 home to conversation core and file-owned configuration",
  requiresFreeBytes: 4 * 1024 ** 3,
  ownedPaths: (ctx) =>
    HOME_CONFIGURATION_FILES.map((name) =>
      join(ctx.paths.home, "config", name),
    ),
  async check(ctx) {
    const reader = new LegacyReader(
      existsSync(sourcePath(ctx)) ? sourcePath(ctx) : ctx.paths.sqlitePath,
      ctx,
    );
    try {
      const checked = await checkConfiguration({
        home: ctx.paths.home,
        context: ctx,
        dataDir: ctx.paths.dataPath,
        reader,
        discarded: ctx.discarded,
      });
      checkedConfiguration.set(ctx, checked);
      checked.failures.push(...reader.failures);
      if (checked.failures.length)
        throw new DiscardableMigrationError(checked.failures);
    } finally {
      reader.close();
    }
  },
  async run(ctx) {
    mkdirSync(ctx.scratchDir, { recursive: true, mode: 0o700 });
    if (existsSync(verifiedPath(ctx))) {
      ctx.log("Resuming verified cleanup");
      return;
    }
    if (ctx.discarded.size)
      ctx.log(`Discarding at user request: ${[...ctx.discarded].join(", ")}`);
    if (reusePreviousImport(ctx)) {
      ctx.log(
        "Reusing the previous import: discarded conversations were never imported",
      );
      quarantineDiscardedConversations(ctx);
      return;
    }
    // A full run rebuilds the database; never trust a summary of a prior run.
    rmSync(summaryPath(ctx), { force: true });
    const journal = new RollbackJournal(ctx.scratchDir);
    try {
      await withRollbackJournal(journal, () => convert(ctx, journal));
      const summary = readJson(summaryPath(ctx)) as CoreImportSummary;
      quarantineDiscardedConversations(ctx);
      includeFailures(ctx, summary.failedConversations);
    } finally {
      resetPreflight();
    }
  },
  async verify(ctx) {
    const summary = readJson(summaryPath(ctx)) as CoreImportSummary;
    ctx.progress(
      "verify-history-and-assets",
      undefined,
      undefined,
      "Verifying migrated history",
    );
    await setImmediate();
    const { selected, failures } = await check(ctx, summary);
    const failed: DiscardableItem[] = [
      ...summary.failedConversations,
      ...failures,
    ];
    if (failed.length) {
      ctx.log(`Conversations failed: ${JSON.stringify(failed)}`);
      // Nothing is removed yet: the user discards these (and the step reruns
      // without them) or rolls the whole step back.
      throw new DiscardableMigrationError(failed);
    }
    ctx.log(
      `Verified: ${JSON.stringify(selected)}; foreign keys clean; quick_check ok`,
    );
  },
  async commit(ctx) {
    const summary = readJson(summaryPath(ctx)) as CoreImportSummary;
    const losses = Object.entries(summary.lossyMappings).map(
      ([reason, count]) => ({ reason, count }),
    );
    if (summary.assets.missingFiles)
      losses.push({
        reason: "Missing legacy assets",
        count: summary.assets.missingFiles,
      });
    replaceLosses(ctx, losses);
    const manifest = readJson(ctx.paths.manifestPath);
    atomicWrite(
      ctx.paths.manifestPath,
      `${JSON.stringify({ ...manifest, version: 2, homeClass: manifest.homeClass ?? "standard" }, null, 2)}\n`,
    );
    ctx.progress(
      "delete-legacy",
      undefined,
      undefined,
      "Removing old storage files",
    );
    await setImmediate();
    await cleanup(ctx, summary);
  },
  async rollback(ctx) {
    // Verification never passed, so the legacy database is intact.
    assert(!existsSync(verifiedPath(ctx)), "Upgrade already verified");
    const source = sourcePath(ctx),
      original = ctx.paths.sqlitePath,
      restoring = join(ctx.scratchDir, "restoring-database");
    // Drop the partial new database once; after the marker, files at the
    // original names may already be restored legacy sidecars.
    if (!existsSync(restoring) && existsSync(source)) {
      for (const suffix of suffixes)
        rmSync(`${original}${suffix}`, { force: true });
      writeJson(restoring, { at: new Date().toISOString() });
    }
    if (existsSync(restoring))
      for (const suffix of ["-wal", "-shm", ""])
        if (existsSync(`${source}${suffix}`))
          renameSync(`${source}${suffix}`, `${original}${suffix}`);
  },
});
