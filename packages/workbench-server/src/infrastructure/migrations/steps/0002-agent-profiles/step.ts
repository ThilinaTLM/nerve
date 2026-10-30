import { isAppliedHome, upgradeProfileDocuments } from "./profile-documents.js";
import { inventory } from "./released-inventory.js";
import {
  releasedBuiltins as builtins,
  readReleasedScope,
  validateReleasedCatalog,
  scopeIssueReport,
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
import { phaseProgress } from "./progress.js";
import { replaceLosses } from "../../framework/toolkit.js";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join, sep } from "node:path";
import type { DatabaseSync } from "node:sqlite";
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
import type { MetadataPatch } from "./released-metadata.js";
import { discoverReleasedHomeSkillSources } from "./released-resources.js";
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
function inputs(
  ctx: StepContext,
  root: string,
  snapshots: Map<string, string>,
): Data {
  const input = readReleasedScope(root, io(ctx), "user", {
    builtins,
    skillSources: {},
    report: () => {},
  });
  validateReleasedCatalog(input, root, "user", {
    builtins,
    skillSources: {},
    report: () => {},
  });
  for (const issue of input.issues)
    ctx.quarantine(
      { kind: "configuration", id: issue.path, reason: issue.reason },
      { files: [issue.path], retainSource: true },
    );
  for (const [path, digest] of input.snapshots) snapshots.set(path, digest);
  return input.before;
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
  await phaseProgress(ctx, "inventory", "Checking migration inputs")();
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
  const convertScopes = phaseProgress(
    ctx,
    "scope-settings",
    "Converting user settings",
    1,
  );
  await convertScopes();
  let convertedScopes = 0;
  for (const { root, input } of [{ root: ctx.paths.home, input: userInput }]) {
    const before = input.before;
    const report: string[] = scopeIssueReport(input.issues);
    const context = {
      report: (message: string) => report.push(`${root}/config: ${message}`),
      builtins,
      documentPath: join(root, "config/capabilities.json"),
      inheritedSettings: {},
      skillSources: await discoverReleasedHomeSkillSources(ctx.paths.home, [
        user,
        before,
      ]),
    };
    validateReleasedCatalog(input, root, "user", context);
    for (const [path, digest] of input.snapshots) snapshots.set(path, digest);
    const result = convertPreferencesV037(
      { ...before, scope: "user" },
      context,
    );
    const targets = input.issues.length
      ? {}
      : isolateScopeTargets(
          root,
          input,
          files,
          releasedScopeTargets(root, "user", before, context, result),
        );
    for (const issue of input.issues)
      ctx.quarantine(
        { kind: "configuration", id: issue.path, reason: issue.reason },
        { files: [issue.path], retainSource: true },
      );
    for (const message of scopeIssueReport(input.issues))
      if (!report.includes(message)) report.push(message);
    const sources = ["harness", "capabilities", "subagents", "integrations"]
      .filter((key) => before[key] !== undefined)
      .map((key) => join(root, "config", `${key}.json`));
    const policyFiles = documentFiles(root, [], []).filter(
      (file) => file.kind === "permissions" || file.kind === "rule-set",
    );
    for (const file of policyFiles) {
      if (!existsSync(file.path)) continue;
      const bytes = readText(file.path);
      snapshots.set(file.path, sha256(bytes));
      const before = parsePolicySource(bytes, file.path, report),
        after = convertDocument(before, file.kind);
      if (before === undefined)
        ctx.quarantine(
          {
            kind: "configuration",
            id: file.path,
            reason: "Invalid policy JSON",
          },
          { files: [file.path], retainSource: true },
        );
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        targets[file.path] = exportedTarget("metadata", after);
        sources.push(file.path);
        report.push(`Converted planning-tool metadata: ${file.path}`);
      }
    }
    add(
      `scope:${root}`,
      root,
      targets,
      sources,
      sources.filter(
        (path) => !input.issues.length && !Object.hasOwn(targets, path),
      ),
      report,
    );
    await convertScopes(++convertedScopes);
  }
  const convertConversations = phaseProgress(
    ctx,
    "conversation-settings",
    "Converting conversation settings",
    original.rows.length,
  );
  await convertConversations();
  let convertedConversations = 0;
  for (const raw of original.rows) {
    const row = raw as unknown as ReleasedConversation;
    const id = row.conversation_id;
    assert(
      /^[a-zA-Z0-9_-]+$/.test(id),
      "Unsafe released conversation identity",
    );
    const root = join(ctx.paths.home, "data/conversations", id);
    const own = inputs(ctx, root, snapshots),
      report: string[] = [];
    const context = {
      report: (message: string) => report.push(`${root}/config: ${message}`),
      builtins,
      documentPath: join(root, "config/capabilities.json"),
      // Project files are owned by lazy project migration, never startup.
      // Preserve explicit conversation opinions without a project baseline.
      inheritedSettings: {},
      skillSources: await discoverReleasedHomeSkillSources(ctx.paths.home, [
        user,
        own,
      ]),
    };
    const userEffective = convertPreferencesV037(
      {
        harness: merge(baseline.harness, user.harness ?? {}),
        integrations: user.integrations,
        capabilities: undefined,
      },
      context,
    ).agent.overrides;
    const baselineSettings: Data = user.capabilities
      ? applyReleasedCapabilities(userEffective, user.capabilities)
      : userEffective;
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
    let document;
    try {
      document = convertConversationV037(
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
    } catch (error) {
      // Preserve the complete SQL contribution before its legacy columns retire.
      // The placeholder cannot execute: its permission policy does not exist.
      const reason = error instanceof Error ? error.message : String(error);
      ctx.quarantine(
        { kind: "conversation", id, reason },
        {
          records: [{ row, settings: own }],
          files: ["harness", "capabilities", "subagents"]
            .map((name) => join(root, "config", `${name}.json`))
            .filter(existsSync),
          retainSource: true,
        },
      );
      report.push("Conversation settings set aside; see quarantine");
      const permissionRuleSetId = `migration-set-aside-${sha256(JSON.stringify(row)).slice(0, 16)}`;
      const frozenDefaults = structuredClone(baselineSettings);
      delete frozenDefaults.subagents;
      delete frozenDefaults.tools.subagents;
      delete frozenDefaults.tools.plan_present;
      document = {
        schemaVersion: 1,
        revision: 0,
        appliedProfile: null,
        overrides: raw.parent_conversation_id ? {} : { permissionRuleSetId },
        ...(raw.parent_conversation_id
          ? {
              frozenDefaults: {
                ...frozenDefaults,
                reasoningLevel: "off",
                permissionRuleSetId,
              },
            }
          : {}),
      };
    }
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
      if (before === undefined)
        ctx.quarantine(
          {
            kind: "configuration",
            id: permissionPath,
            reason: "Invalid policy JSON",
          },
          { files: [permissionPath], retainSource: true },
        );
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
    await convertConversations(++convertedConversations);
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
  for (const item of value.receipts) {
    exportReceiptSchema.parse(item.receipt);
    assert(
      item.receipt.identity === `scope:${ctx.paths.home}` ||
        (item.receipt.identity.startsWith("conversation:") &&
          Object.hasOwn(
            value.rows,
            item.receipt.identity.slice("conversation:".length),
          )),
      "Archived migration plan contains project receipts; restore the home backup before retrying",
    );
  }
  return value;
}
async function verify(
  ctx: StepContext,
  plan: Plan,
  connection?: DatabaseSync,
): Promise<void> {
  await phaseProgress(ctx, "verify-inputs", "Checking original settings")();
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
  await verifyConversationExports(
    io(ctx),
    current.rows as unknown as ReleasedConversation[],
    plan.receipts.map((item) => item.receipt),
    false,
    phaseProgress(
      ctx,
      "verify-conversations",
      "Verifying conversation settings",
      current.rows.length,
    ),
  );
  const progress = phaseProgress(
    ctx,
    "verify-exports",
    "Verifying exported settings",
    plan.receipts.length,
  );
  await progress();
  let done = 0;
  for (const item of plan.receipts) {
    verifyExport(io(ctx), item.receipt, item.receipt.rowDigest);
    await progress(++done);
  }
}

function completion(ctx: StepContext, plan: Plan) {
  const retireProgress = phaseProgress(
    ctx,
    "retire-sources",
    "Finishing settings upgrade",
    plan.receipts.length,
  );
  let retired = 0;
  return {
    receipts: plan.receipts.map((item) => item.receipt),
    async verifyFiles() {
      await verifyConversationExports(
        io(ctx),
        plan.sourceRows,
        plan.receipts.map((item) => item.receipt),
        true,
        phaseProgress(
          ctx,
          "verify-conversations",
          "Verifying conversation settings",
          plan.sourceRows.length,
        ),
      );
      const progress = phaseProgress(
        ctx,
        "verify-exports",
        "Verifying exported settings",
        plan.receipts.length,
      );
      await progress();
      let done = 0;
      for (const item of plan.receipts) {
        verifyExport(io(ctx), item.receipt, item.receipt.rowDigest, true);
        await progress(++done);
      }
    },
    async retire(receipt: ExportReceipt) {
      if (retired === 0) await retireProgress();
      retireExportSources(io(ctx), receipt);
      await retireProgress(++retired);
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
  description: "Move agent settings to configuration files",
  async run(ctx) {
    if (isAppliedHome(ctx)) {
      upgradeProfileDocuments(ctx);
      return;
    }
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
      if (backend.state() === "released") {
        const progress = phaseProgress(
          ctx,
          "export-settings",
          "Saving configuration files",
          plan.receipts.length,
        );
        await progress();
        let done = 0;
        for (const item of plan.receipts) {
          applyExport(io(ctx), item.path, item.receipt);
          await progress(++done);
        }
      }
      await executeReleasedMigration(
        backend,
        completion(ctx, plan),
        (phase, label) => phaseProgress(ctx, phase, label)(),
      );
    } finally {
      backend.close();
    }
    replaceLosses(
      ctx,
      [
        "Removed bundled Explore/Developer parent-copy model and reasoning behavior",
        ...plan.receipts.flatMap((item) => item.receipt.report),
        ...plan.metadata.flatMap((patch) => patch.reasons ?? []),
      ].map((reason) => ({ reason, count: 1 })),
    );
  },
  async verify(ctx) {
    if (isAppliedHome(ctx)) {
      upgradeProfileDocuments(ctx, true);
      return;
    }
    const plan = loadPlan(ctx),
      backend = new ReleasedSqliteBackend(
        ctx,
        plan,
        (db) => verify(ctx, plan, db),
        archiveRoot(ctx),
      );
    try {
      await phaseProgress(ctx, "verify-backup", "Checking database backup")();
      backend.verifyBackup();
      await backend.verifyConverted();
      await completion(ctx, plan).verifyFiles();
    } finally {
      backend.close();
    }
  },
  async commit(ctx) {
    if (isAppliedHome(ctx)) return;
    await retireReleasedSources(completion(ctx, loadPlan(ctx)));
    finishMigrationArchive(ctx.paths.home, archiveRoot(ctx), "committed");
  },
  async rollback(ctx) {
    if (isAppliedHome(ctx)) {
      new RollbackJournal(ctx.scratchDir).restore();
      return;
    }
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
    await restoreReleasedDatabase(ctx, plan, archiveRoot(ctx));
    for (const item of plan.receipts) {
      if (existsSync(item.path)) rollbackExport(io(ctx), item.receipt);
    }
    new RollbackJournal(ctx.scratchDir).restore();
    finishMigrationArchive(ctx.paths.home, archiveRoot(ctx), "rolled-back");
  },
});
