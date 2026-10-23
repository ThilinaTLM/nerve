import {
  releasedBuiltins as builtins,
  readReleasedScope,
  validateReleasedCatalog,
  scopeIssueReport,
  type ReleasedScopeInput,
} from "./released-scope.js";
import {
  releasedScopeTargets,
  isolateScopeTargets,
} from "./released-scope-targets.js";
import {
  beginMigrationArchive,
  currentMigrationArchive,
  finishMigrationArchive,
} from "./released-archive.js";
import { replaceLosses } from "../../framework/toolkit.js";
import { coreMigrations } from "@nervekit/conversation-core";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { defineStep, type StepContext } from "../../framework/step.js";
import { RollbackJournal } from "../../framework/rollback-journal.js";
import {
  json,
  safePath,
  readText,
  writeProtected,
  withDurableParents,
} from "./files.js";
import baseline from "./released-baseline.json" with { type: "json" };
import {
  convertDocument,
  documentFiles,
  parsePolicySource,
} from "./documents.js";
import { verifyConversationExports } from "./released-verification.js";
import { planMetadata, type MetadataPatch } from "./released-metadata.js";
import { discoverReleasedSkillSources } from "./released-resources.js";
import {
  executeReleasedMigration,
  retireReleasedSources,
} from "./released-executor.js";
import {
  ReleasedSqliteBackend,
  restoreReleasedDatabase,
} from "./released-sqlite.js";
import { retireExportSources } from "./released-export.js";
import {
  convertPreferencesV037,
  applyReleasedCapabilities,
  convertConversationV037,
  merge,
  sha256,
  type Data,
  type ReleasedConversation,
} from "./released-format.js";
import {
  applyExport,
  prepareExport,
  verifyExport,
  exportedTarget,
  releasedRowDigest,
  exportReceiptSchema,
  convertedTrust,
  rollbackExport,
  preflightRollbackExport,
  type ExportReceipt,
  type ExportIO,
  type ExportTarget,
  type OriginalTrust,
} from "./released-export.js";

const archiveRoot = (ctx: StepContext) => {
  const archive = currentMigrationArchive(ctx.paths.home);
  assert(archive, "Migration archive is missing");
  return archive.directory;
};
function io(ctx: StepContext): ExportIO {
  return {
    read(path) {
      safePath(path);
      return existsSync(path) ? readText(path) : undefined;
    },
    write(path, bytes) {
      safePath(path);
      if (path.startsWith(archiveRoot(ctx) + sep)) writeProtected(path, bytes);
      else withDurableParents(path, () => ctx.fs.write(path, bytes));
    },
    remove(path) {
      safePath(path);
      ctx.fs.remove(path);
    },
  };
}
function inputs(root: string, snapshots: Map<string, string>): Data {
  const value: Data = {};
  for (const name of ["harness", "capabilities", "subagents", "integrations"]) {
    const path = join(root, "config", name + ".json");
    safePath(path);
    if (existsSync(path)) {
      const bytes = readText(path);
      snapshots.set(path, sha256(bytes));
      value[name] = JSON.parse(bytes);
    }
  }
  return value;
}
function inventory(ctx: StepContext, connection?: DatabaseSync) {
  safePath(ctx.paths.sqlitePath);
  const db =
    connection ?? new DatabaseSync(ctx.paths.sqlitePath, { readOnly: true });
  try {
    const columns = db
      .prepare("PRAGMA table_info(conversation_config)")
      .all()
      .map((row) => row.name);
    assert.deepEqual(
      columns,
      [
        "conversation_id",
        "model",
        "reasoning_level",
        "system_prompt",
        "instructions",
        "permission_rule_set_id",
        "mode",
        "working_directory",
      ],
      "Migration requires released v0.37.0 SQL, not intermediate/custom state",
    );
    const dependencies = db
      .prepare(
        "SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND type IN ('index','trigger','view')",
      )
      .all();
    for (const dependency of dependencies) {
      const touchesRebuilt =
        dependency.tbl_name === "conversation" ||
        dependency.tbl_name === "conversation_config" ||
        dependency.tbl_name === "trusted_resource" ||
        /\b(conversation|conversation_config|trusted_resource)\b/i.test(
          String(dependency.sql),
        );
      assert(
        !touchesRebuilt ||
          (dependency.type === "index" &&
            [
              "trusted_resource_project_path",
              "trusted_resource_user_path",
              "conversation_project_parent_updated",
              "conversation_parent",
              "conversation_pinned",
            ].includes(String(dependency.name))),
        `Unsupported SQL dependency on rebuilt tables: ${dependency.name}`,
      );
    }
    const normalizeSql = (sql: string) =>
      sql.replaceAll('"', "").replace(/\s+/g, " ").replace(/;$/, "").trim();
    const v1 = coreMigrations.find((migration) => migration.version === 1)!;
    assert.equal(
      db.prepare("SELECT checksum FROM schema_migrations WHERE version=1").get()
        ?.checksum,
      sha256(v1.sql),
      "Released SQL checksum mismatch",
    );
    assert.equal(
      db.prepare("SELECT count(*) AS n FROM schema_migrations").get()?.n,
      1,
      "Not released SQL v1",
    );
    for (const table of [
      "conversation",
      "conversation_config",
      "trusted_resource",
    ]) {
      const start = v1.sql.indexOf("CREATE TABLE " + table + " (");
      const end = v1.sql.indexOf(") STRICT;", start) + ") STRICT;".length;
      assert(start >= 0 && end > start);
      const actual = db
        .prepare("SELECT sql FROM sqlite_schema WHERE type='table' AND name=?")
        .get(table)?.sql;
      assert.equal(
        normalizeSql(String(actual)),
        normalizeSql(v1.sql.slice(start, end)),
        "Custom SQL definition requires review before rebuild",
      );
    }
    for (const index of [
      "trusted_resource_project_path",
      "trusted_resource_user_path",
      "conversation_project_parent_updated",
      "conversation_parent",
      "conversation_pinned",
    ]) {
      const start = v1.sql.indexOf(
          (index.startsWith("trusted_resource_")
            ? "CREATE UNIQUE INDEX "
            : "CREATE INDEX ") +
            index +
            " ",
        ),
        end = v1.sql.indexOf(";", start);
      assert.equal(
        normalizeSql(
          String(
            db
              .prepare(
                "SELECT sql FROM sqlite_schema WHERE type='index' AND name=?",
              )
              .get(index)?.sql,
          ),
        ),
        normalizeSql(v1.sql.slice(start, end)),
        "Custom trust index requires review",
      );
    }
    const projects = db
      .prepare("SELECT id, directory FROM project ORDER BY id")
      .all();
    const rows = db
      .prepare(
        `SELECT cfg.*, c.parent_conversation_id, c.project_id FROM conversation_config cfg JOIN conversation c ON c.id=cfg.conversation_id ORDER BY cfg.conversation_id`,
      )
      .all();
    assert.equal(
      rows.length,
      db.prepare("SELECT count(*) AS n FROM conversation").get()?.n,
      "Missing conversation configuration row",
    );
    assert.equal(
      rows.length,
      db.prepare("SELECT count(*) AS n FROM conversation_config").get()?.n,
      "Unexported/orphan conversation config row",
    );
    assert.deepEqual(
      db.prepare("PRAGMA foreign_key_check").all(),
      [],
      "Released database has broken foreign keys",
    );
    const trust: OriginalTrust[] = db
      .prepare(
        "SELECT id,name,created_at,updated_at,project_id,kind,path,content_digest,status FROM trusted_resource ORDER BY id",
      )
      .all()
      .map((row) => ({
        id: String(row.id),
        name: row.name === null ? null : String(row.name),
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
        projectId: row.project_id === null ? null : String(row.project_id),
        kind: String(row.kind),
        path: String(row.path),
        contentDigest: String(row.content_digest),
        status: row.status === "trusted" ? "trusted" : "rejected",
      }));
    const metadata = planMetadata({
      events: db
        .prepare(
          "SELECT id,payload FROM conversation_event WHERE instr(payload, 'plan_mode_present') > 0",
        )
        .all()
        .map((row) => ({ id: String(row.id), payload: String(row.payload) })),
      calls: db
        .prepare(
          "SELECT id,tool_name,interaction FROM tool_call WHERE tool_name='plan_mode_present' OR interaction IS NOT NULL",
        )
        .all()
        .map((row) => ({
          id: String(row.id),
          toolName: String(row.tool_name),
          interaction:
            row.interaction === null ? null : String(row.interaction),
        })),
    });
    return { projects, rows, trust, metadata };
  } finally {
    if (!connection) db.close();
  }
}
export interface Plan {
  schemaVersion: 1;
  createdAt: string;
  metadata: MetadataPatch[];
  sourceTrust: OriginalTrust[];
  sourceRows: ReleasedConversation[];
  projectDirectories: Record<string, string>;
  receipts: { path: string; receipt: ExportReceipt }[];
  rows: Record<string, string>;
  trust: ReturnType<typeof convertedTrust>[];
}
const planPath = (ctx: StepContext) => join(archiveRoot(ctx), "plan.json");
async function planExports(ctx: StepContext): Promise<Plan> {
  const files = io(ctx),
    original = inventory(ctx);
  const snapshots = new Map<string, string>();
  const baseContext = { builtins, skillSources: {}, report: () => {} };
  const userInput = readReleasedScope(
    ctx.paths.home,
    files,
    "user",
    baseContext,
  );
  const user = userInput.before;
  const lower = convertPreferencesV037(user, baseContext).agent.overrides;
  const receipts: Plan["receipts"] = [],
    rows: Plan["rows"] = {},
    trust: Plan["trust"] = [];
  const claimed = new Set<string>();
  function add(
    identity: string,
    root: string,
    targets: Record<string, ExportTarget>,
    sources: string[],
    retire: string[],
    report: string[],
    rowDigest?: string,
  ) {
    for (const path of Object.keys(targets)) {
      assert(!claimed.has(path), `Duplicate conversion target: ${path}`);
      claimed.add(path);
    }
    ctx.ownPaths([...sources, ...Object.keys(targets)], root);
    const path = join(archiveRoot(ctx), sha256(identity), "receipt.json");
    for (const source of sources)
      assert.equal(
        sha256(files.read(source)!),
        snapshots.get(source),
        "Source changed while planning conversion",
      );
    const receipt = prepareExport(files, {
      identity,
      backupDirectory: join(archiveRoot(ctx), sha256(identity)),
      sources,
      targets,
      rowDigest,
      retire,
      report,
    });
    receipts.push({ path, receipt });
    return receipt;
  }
  const converted = new Map<
    string,
    ReturnType<typeof convertPreferencesV037>
  >();
  const projectInputs = new Map<string, ReleasedScopeInput>();
  for (const project of original.projects)
    projectInputs.set(
      String(project.id),
      readReleasedScope(
        join(String(project.directory), ".nerve"),
        files,
        "project",
        { ...baseContext, inheritedSettings: lower },
      ),
    );
  for (const { root, input, project } of [
    { root: ctx.paths.home, input: userInput, project: undefined },
    ...original.projects.map((project) => ({
      root: join(String(project.directory), ".nerve"),
      input: projectInputs.get(String(project.id))!,
      project,
    })),
  ]) {
    const before = input.before;
    const report: string[] = scopeIssueReport(input.issues);
    const context = {
      report: (message: string) => report.push(`${root}/config: ${message}`),
      builtins,
      documentPath: join(root, "config/capabilities.json"),
      inheritedSettings: project ? converted.get("user")?.agent.overrides : {},
      skillSources: await discoverReleasedSkillSources(
        ctx.paths.home,
        project ? String(project.directory) : ctx.paths.home,
        [user, before],
      ),
    };
    validateReleasedCatalog(input, root, project ? "project" : "user", context);
    for (const [path, digest] of input.snapshots) snapshots.set(path, digest);
    const result = convertPreferencesV037(
      { ...before, scope: project ? "project" : "user" },
      context,
    );
    converted.set(project ? String(project.id) : "user", result);
    const targets = input.issues.length
      ? {}
      : isolateScopeTargets(
          root,
          input,
          files,
          releasedScopeTargets(
            root,
            project ? "project" : "user",
            before,
            context,
            result,
          ),
        );
    for (const message of scopeIssueReport(input.issues))
      if (!report.includes(message)) report.push(message);
    const sources = ["harness", "capabilities", "subagents", "integrations"]
      .filter((key) => before[key] !== undefined)
      .map((key) => join(root, "config", `${key}.json`));
    const policyFiles = project
      ? [
          {
            path: join(root, "config/permissions.json"),
            kind: "permissions" as const,
          },
        ]
      : documentFiles(root, [], []).filter(
          (file) => file.kind === "permissions" || file.kind === "rule-set",
        );
    for (const file of policyFiles) {
      if (!existsSync(file.path)) continue;
      const bytes = readText(file.path);
      snapshots.set(file.path, sha256(bytes));
      const before = parsePolicySource(bytes, file.path, report),
        after = convertDocument(before, file.kind);
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        targets[file.path] = exportedTarget("metadata", after);
        sources.push(file.path);
        report.push(`Converted planning-tool metadata: ${file.path}`);
      }
    }
    const receipt = add(
      `scope:${root}`,
      root,
      targets,
      sources,
      sources.filter(
        (path) => !input.issues.length && !Object.hasOwn(targets, path),
      ),
      report,
    );
    if (project)
      for (const [path, target] of Object.entries(targets)) {
        const names =
          target.kind === "profile"
            ? ["subagents"]
            : target.kind === "preferences"
              ? ["capabilities", "subagents"]
              : path === join(root, "config/permissions.json")
                ? ["permissions"]
                : [];
        if (!names.length) continue;
        const contributions = names
          .map((name) => ({
            path: join(root, "config", name + ".json"),
            kind:
              name === "subagents"
                ? "subagent_profile"
                : name === "permissions"
                  ? "project_permissions"
                  : "project_capabilities",
          }))
          .filter((source) => receipt.sources[source.path]);
        const decision = convertedTrust(
          original.trust,
          contributions.map((source) => ({
            ...source,
            digest: receipt.sources[source.path].digest,
            projectId: String(project.id),
          })),
          path,
          target.digest,
          target.kind === "profile"
            ? "agent_profile"
            : path === join(root, "config/permissions.json")
              ? "project_permissions"
              : "project_capabilities",
        );
        decision.projectId = String(project.id);
        trust.push(decision);
        if (decision.report) receipt.report.push(decision.report);
      }
  }
  for (const raw of original.rows) {
    const row = raw as unknown as ReleasedConversation;
    const id = row.conversation_id,
      projectId = String(raw.project_id);
    assert(
      /^[a-zA-Z0-9_-]+$/.test(id),
      "Unsafe released conversation identity",
    );
    const project = original.projects.find(
      (project) => project.id === projectId,
    );
    assert(project, "Missing project");
    const before = projectInputs.get(projectId)!.before;
    const root = join(ctx.paths.home, "data/conversations", id);
    const own = inputs(root, snapshots),
      report: string[] = [];
    const context = {
      report: (message: string) => report.push(`${root}/config: ${message}`),
      builtins,
      documentPath: join(root, "config/capabilities.json"),
      inheritedSettings: merge(
        converted.get("user")?.agent.overrides ?? {},
        trust.some(
          (entry) =>
            entry.projectId === projectId &&
            entry.kind === "project_capabilities" &&
            entry.status === "trusted",
        )
          ? (converted.get(projectId)?.agent.overrides ?? {})
          : {},
      ),
      skillSources: await discoverReleasedSkillSources(
        ctx.paths.home,
        String(project.directory),
        [user, before, own],
      ),
    };
    const userEffective = convertPreferencesV037(
      {
        harness: merge(baseline.harness, user.harness ?? {}),
        integrations: user.integrations,
        capabilities: undefined,
      },
      context,
    ).agent.overrides;
    // Untrusted project capabilities are converted, but not frozen as applicable settings.
    const projectRoot = join(String(project.directory), ".nerve");
    const capPath = join(projectRoot, "config/capabilities.json");
    const capBytes =
      before.capabilities === undefined ? undefined : files.read(capPath);
    const trusted =
      capBytes !== undefined &&
      original.trust.some(
        (entry) =>
          entry.path === capPath &&
          entry.kind === "project_capabilities" &&
          entry.projectId === projectId &&
          entry.status === "trusted" &&
          [sha256(capBytes), `sha256:${sha256(capBytes)}`].includes(
            entry.contentDigest,
          ),
      );
    let baselineSettings: Data = user.capabilities
      ? applyReleasedCapabilities(userEffective, user.capabilities)
      : userEffective;
    baselineSettings = merge(
      baselineSettings,
      convertPreferencesV037(
        { harness: before.harness, scope: "project" },
        context,
      ).agent.overrides,
    );
    if (trusted && before.capabilities)
      baselineSettings = applyReleasedCapabilities(
        baselineSettings,
        before.capabilities,
      );
    baselineSettings.tools = merge(
      {
        jira: { enabled: false },
        confluence: { enabled: false },
        python_exec: { settings: {} },
      },
      baselineSettings.tools ?? {},
    );
    baselineSettings.skills = merge(
      {
        defaults: { file: true, nerve: false, agentBrowser: false },
        file: {},
        nerve: {},
        agentBrowser: {},
      },
      baselineSettings.skills ?? {},
    );
    // Capture eligible identities and concrete decisions. Later discovery cannot expand this set.
    for (const [name, sources] of Object.entries(context.skillSources))
      for (const source of sources)
        baselineSettings.skills[source][name] ??=
          baselineSettings.skills.defaults[source];
    const document = convertConversationV037(
      row,
      {
        capabilities: own.capabilities,
        harness: own.harness,
        subagents: own.subagents,
        ...(raw.parent_conversation_id
          ? { childDefaults: baselineSettings }
          : {}),
      },
      context,
    );
    const sources = ["harness", "capabilities", "subagents"]
      .filter((name) => own[name] !== undefined)
      .map((name) => join(root, "config", `${name}.json`));
    const outputs: Record<string, ExportTarget> = {
      [join(root, "config/agent.json")]: exportedTarget(
        raw.parent_conversation_id ? "child" : "lead",
        document,
      ),
    };
    const permissionPath = join(root, "config/permissions.json");
    if (existsSync(permissionPath)) {
      const bytes = readText(permissionPath),
        before = parsePolicySource(bytes, permissionPath, report),
        after = convertDocument(before, "permissions");
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        snapshots.set(permissionPath, sha256(bytes));
        sources.push(permissionPath);
        outputs[permissionPath] = exportedTarget("metadata", after);
        report.push(permissionPath + ": converted planning tool selectors");
      }
    }
    const rowDigest = releasedRowDigest(row);
    rows[id] = rowDigest;
    add(
      `conversation:${id}`,
      ctx.paths.home,
      outputs,
      sources,
      sources.filter((path) => !Object.hasOwn(outputs, path)),
      report,
      rowDigest,
    );
  }
  return {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    receipts,
    rows,
    trust,
    metadata: original.metadata,
    sourceTrust: original.trust,
    sourceRows: original.rows as unknown as ReleasedConversation[],
    projectDirectories: Object.fromEntries(
      original.projects.map((project) => [
        String(project.id),
        String(project.directory),
      ]),
    ),
  };
}
function loadPlan(ctx: StepContext): Plan {
  const value = json(planPath(ctx)) as Plan;
  assert.equal(value.schemaVersion, 1);
  for (const item of value.receipts) exportReceiptSchema.parse(item.receipt);
  return value;
}
function verify(ctx: StepContext, plan: Plan, connection?: DatabaseSync): void {
  const current = inventory(ctx, connection);
  assert.deepEqual(
    plan.sourceRows.map(releasedRowDigest),
    current.rows.map((row) =>
      releasedRowDigest(row as unknown as ReleasedConversation),
    ),
    "Durable source row receipt changed",
  );
  assert.deepEqual(
    current.trust,
    plan.sourceTrust,
    "Original trust changed since export",
  );
  assert.deepEqual(
    Object.fromEntries(
      current.projects.map((project) => [
        String(project.id),
        String(project.directory),
      ]),
    ),
    plan.projectDirectories,
    "Known projects changed since export",
  );
  assert.deepEqual(
    current.metadata,
    plan.metadata,
    "Stored planning metadata changed since export",
  );
  assert.deepEqual(
    Object.fromEntries(
      current.rows.map((row) => {
        const released = row as unknown as ReleasedConversation;
        return [released.conversation_id, releasedRowDigest(released)];
      }),
    ),
    plan.rows,
    "Conversation row set/values changed since export",
  );
  verifyConversationExports(
    io(ctx),
    current.rows as unknown as ReleasedConversation[],
    plan.receipts.map((item) => item.receipt),
  );
  for (const item of plan.receipts)
    verifyExport(io(ctx), item.receipt, item.receipt.rowDigest);
}

function completion(ctx: StepContext, plan: Plan) {
  return {
    receipts: plan.receipts.map((item) => item.receipt),
    verifyFiles() {
      verifyConversationExports(
        io(ctx),
        plan.sourceRows,
        plan.receipts.map((item) => item.receipt),
        true,
      );
      for (const item of plan.receipts)
        verifyExport(io(ctx), item.receipt, item.receipt.rowDigest, true);
    },
    retire(receipt: ExportReceipt) {
      retireExportSources(io(ctx), receipt);
    },
    committed() {
      io(ctx).write(
        join(archiveRoot(ctx), "committed.json"),
        JSON.stringify({
          schemaVersion: 1,
          planDigest: sha256(JSON.stringify(plan)),
        }) + "\n",
      );
    },
  };
}
export default defineStep({
  id: "0002-agent-profiles",
  description: "Export released scoped agent configuration (SQL review draft)",
  async run(ctx) {
    beginMigrationArchive(ctx.paths.home);
    if (process.platform === "win32")
      ctx.log(
        "Directory fsync is unsupported on Windows; migration file bytes are synced but directory durability is limited",
      );
    // No discardable units: losing one document can never authorize destructive DDL.
    const plan = existsSync(planPath(ctx))
      ? loadPlan(ctx)
      : await planExports(ctx);
    if (!existsSync(planPath(ctx)))
      io(ctx).write(planPath(ctx), JSON.stringify(plan, null, 2) + "\n");
    const backend = new ReleasedSqliteBackend(
      ctx,
      plan,
      (db) => verify(ctx, plan, db),
      archiveRoot(ctx),
    );
    try {
      if (backend.state() === "released")
        for (const item of plan.receipts)
          applyExport(io(ctx), item.path, item.receipt);
      await executeReleasedMigration(backend, completion(ctx, plan));
    } finally {
      backend.close();
    }
    replaceLosses(
      ctx,
      [
        "Removed bundled Explore/Developer parent-copy model and reasoning behavior",
        ...plan.receipts.flatMap((item) => item.receipt.report),
      ].map((reason) => ({ reason, count: 1 })),
    );
  },
  async verify(ctx) {
    const plan = loadPlan(ctx),
      backend = new ReleasedSqliteBackend(
        ctx,
        plan,
        (db) => verify(ctx, plan, db),
        archiveRoot(ctx),
      );
    try {
      backend.verifyBackup();
      backend.verifyConverted();
      completion(ctx, plan).verifyFiles();
    } finally {
      backend.close();
    }
  },
  async commit(ctx) {
    retireReleasedSources(completion(ctx, loadPlan(ctx)));
    finishMigrationArchive(ctx.paths.home, archiveRoot(ctx), "committed");
  },
  async rollback(ctx) {
    const archive = currentMigrationArchive(ctx.paths.home);
    if (!archive) return;
    assert(
      archive.state !== "committed",
      "Verified migration cannot be rolled back automatically",
    );
    if (!existsSync(planPath(ctx))) {
      finishMigrationArchive(ctx.paths.home, archive.directory, "rolled-back");
      return;
    }
    const plan = loadPlan(ctx);
    for (const item of plan.receipts)
      if (existsSync(item.path)) preflightRollbackExport(io(ctx), item.receipt);
    restoreReleasedDatabase(ctx, plan, archiveRoot(ctx));
    for (const item of plan.receipts) {
      if (existsSync(item.path)) rollbackExport(io(ctx), item.receipt);
    }
    new RollbackJournal(ctx.scratchDir).restore();
    finishMigrationArchive(ctx.paths.home, archiveRoot(ctx), "rolled-back");
  },
});
