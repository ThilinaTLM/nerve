import { assertProjectedPayload } from "./result-projection.js";
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
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { defineStep, type StepContext } from "../../framework/step.js";
import {
  importCoreStorage,
  type CoreImportSummary,
} from "./importer.service.js";
import {
  atomicWrite,
  convertConfiguration,
  readJson,
  writeJson,
} from "./configuration.js";
import { LegacyReader, type Legacy } from "./legacy.reader.js";
import { CoreStorage } from "./storage.js";
import { coreSchemaV1 } from "./schema.js";
import {
  verifySelectedPath,
  type SelectedPathVerification,
} from "./selected-path.validation.js";

const suffixes = ["", "-wal", "-shm"];
const summaryPath = (ctx: StepContext) =>
  join(ctx.scratchDir, "import-summary.json");
const verifiedPath = (ctx: StepContext) =>
  join(ctx.scratchDir, "verified.json");
const sourcePath = (ctx: StepContext) => `${ctx.paths.sqlitePath}.migrating`;

function preserveBashOutputs(ctx: StepContext): void {
  const storage = new CoreStorage(ctx.paths.sqlitePath, false);
  try {
    for (const row of storage.sqlite
      .prepare(
        "SELECT id, conversation_id, async_bash_id, logical_path FROM asset WHERE logical_path LIKE 'tasks/%'",
      )
      .iterate()) {
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
function* files(path: string): Generator<string> {
  if (!existsSync(path)) return;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) yield* files(child);
    else if (entry.isFile()) yield child;
  }
}
function check(
  ctx: StepContext,
  summary: CoreImportSummary,
): SelectedPathVerification {
  const storage = new CoreStorage(ctx.paths.sqlitePath, false);
  const reader =
    existsSync(sourcePath(ctx)) && !existsSync(verifiedPath(ctx))
      ? new LegacyReader(sourcePath(ctx))
      : undefined;
  const selected: SelectedPathVerification = {
    roots: 0,
    children: 0,
    userMessageMismatches: [],
    headMismatches: [],
    unansweredToolCalls: 0,
    duplicateToolResults: 0,
    orphanToolResults: 0,
  };
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
    for (const path of summary.paths)
      verifySelectedPath({ ...path, reader, storage, summary: selected });
    assert(
      selected.userMessageMismatches.length === 0 &&
        selected.headMismatches.length === 0 &&
        selected.unansweredToolCalls === 0 &&
        selected.duplicateToolResults === 0 &&
        selected.orphanToolResults === 0,
      `Selected history verification failed: ${JSON.stringify(selected)}`,
    );
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
      .prepare("SELECT event_type AS type, payload FROM conversation_event")
      .iterate()) {
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
        const complete = readJson(join(ctx.paths.dataPath, result.logicalPath));
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
    }
    ctx.log(
      `Payload bytes: ${JSON.stringify({ events: { count: payloadCount, max: payloadMax, avg: payloadCount ? payloadTotal / payloadCount : 0 }, toolResponses: { count: responseCount, max: responseMax, avg: responseCount ? responseTotal / responseCount : 0 } })}`,
    );
    const paths = new Set<string>(),
      missing = new Set(summary.assets.missingAssetIds);
    for (const row of storage.sqlite
      .prepare("SELECT id, logical_path, byte_length FROM asset")
      .iterate()) {
      const logical = String(row.logical_path);
      assert(!logical.startsWith("/") && !logical.split("/").includes(".."));
      paths.add(logical);
      const path = join(ctx.paths.dataPath, logical);
      if (!existsSync(path))
        assert(missing.has(String(row.id)), `Newly missing asset: ${logical}`);
      else {
        assert(lstatSync(path).isFile());
        assert.equal(
          lstatSync(path).size,
          Number(row.byte_length),
          `Asset size changed: ${logical}`,
        );
      }
    }
    assert.equal(
      paths.size,
      summary.assets.trackedFiles,
      "Asset coverage changed",
    );
    if (reader) {
      let scanned = 0;
      for (const { data } of reader.documents("conversation")) {
        assert(/^conv_[A-Za-z0-9_-]+$/.test(data.id));
        for (const path of files(
          join(ctx.paths.conversationsPath, data.id.slice(5), "tool-calls"),
        )) {
          assert(
            paths.has(
              summary.assets.relocatedPayloads[
                relative(ctx.paths.dataPath, path).split("\\").join("/")
              ] ?? relative(ctx.paths.dataPath, path).split("\\").join("/"),
            ),
            `Untracked source asset: ${path}`,
          );
          scanned++;
        }
      }
      assert.equal(
        scanned,
        summary.assets.diskFiles,
        "Source asset coverage changed",
      );
      assert.equal(
        selected.roots,
        Number(
          reader.db
            .prepare(
              "SELECT count(*) AS n FROM domain_documents WHERE namespace = 'conversation'",
            )
            .get()!.n,
        ),
      );
    }
    assert.equal(
      selected.roots + selected.children,
      summary.counts.conversation,
    );
    return selected;
  } finally {
    reader?.close();
    storage.close();
  }
}
function cleanup(ctx: StepContext, summary: CoreImportSummary): void {
  for (const logical of Object.keys(summary.assets.relocatedPayloads)) {
    assert(!isAbsolute(logical) && !logical.split(/[\\/]/).includes(".."));
    rmSync(join(ctx.paths.dataPath, logical), { force: true });
  }
  // All referenced task outputs have verified replacements in conversation storage.
  for (const path of [
    ctx.paths.tasksPath,
    ctx.paths.queryCachePath,
    `${ctx.paths.queryCachePath}-wal`,
    `${ctx.paths.queryCachePath}-shm`,
    join(ctx.paths.home, "journal"),
    join(ctx.paths.dataPath, "journal"),
    join(ctx.paths.dataPath, "state.sqlite"),
    join(ctx.paths.dataPath, "core.sqlite"),
  ]) {
    rmSync(path, { recursive: true, force: true });
  }
  for (const name of readdirSync(ctx.paths.migrationsPath)) {
    if (name !== "work" && name !== "last-failure.json")
      rmSync(join(ctx.paths.migrationsPath, name), {
        recursive: true,
        force: true,
      });
  }
  for (const path of [
    join(ctx.paths.dataPath, "migrations"),
    join(ctx.paths.home, "migration-journal.json"),
  ])
    rmSync(path, { recursive: true, force: true });
  // Source is last: a crash during cleanup is resumed from the verified checkpoint.
  for (const suffix of ["-wal", "-shm", ""])
    rmSync(`${sourcePath(ctx)}${suffix}`, { force: true });
}

export default defineStep({
  id: "0001-conversation-core",
  description:
    "Convert the 0.34.1 home to conversation core and file-owned configuration",
  requiresFreeBytes: 4 * 1024 ** 3,
  async run(ctx) {
    mkdirSync(ctx.scratchDir, { recursive: true, mode: 0o700 });
    if (existsSync(verifiedPath(ctx))) {
      ctx.log("Resuming verified cleanup");
      return;
    }
    ctx.progress("rename-source");
    const source = sourcePath(ctx),
      original = ctx.paths.sqlitePath;
    const old = existsSync(source) ? source : original;
    assert(
      lstatSync(old).isFile(),
      "Migration database must be a regular file",
    );
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
    const sourceReader = new LegacyReader(source);
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
    ctx.progress("configuration");
    const conversions = convertConfiguration(ctx.paths.home, ctx.scratchDir);
    ctx.log(`Configuration conversions: ${JSON.stringify(conversions)}`);
    const reader = new LegacyReader(source);
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
    const summary = await importCoreStorage({
      home: ctx.paths.home,
      scratchDir: ctx.scratchDir,
      progress: () => ctx.progress("import", ++done, total),
    });
    ctx.progress("preserve-task-outputs");
    preserveBashOutputs(ctx);
    writeJson(summaryPath(ctx), summary);
    ctx.log(
      `Imported: ${JSON.stringify({ counts: summary.counts, overlays: summary.overlays, preferences: summary.preferences, assets: summary.assets, losses: summary.lossyMappings, skipped: summary.skipped })}`,
    );
  },
  async verify(ctx) {
    const summary = readJson(summaryPath(ctx)) as CoreImportSummary;
    ctx.progress("verify-history-and-assets");
    const selected = check(ctx, summary);
    ctx.log(
      `Verified: ${JSON.stringify(selected)}; foreign keys clean; quick_check ok`,
    );
    // The runner appends its ledger only after this verify returns. This marker
    // bridges a crash after deleting the source but before the ledger append.
    writeJson(verifiedPath(ctx), { verifiedAt: new Date().toISOString() });
    const manifest = readJson(ctx.paths.manifestPath);
    atomicWrite(
      ctx.paths.manifestPath,
      `${JSON.stringify({ ...manifest, version: 2, homeClass: manifest.homeClass ?? "standard" }, null, 2)}\n`,
    );
    ctx.progress("delete-legacy");
    cleanup(ctx, summary);
  },
});
