import {
  releasedBuiltins,
  readReleasedScope,
  validateReleasedCatalog,
  LegacyScopeError,
  scopeIssueReport,
  legacyScopeFailure,
} from "./released-scope.js";
import { releasedScopeTargets } from "./released-scope-targets.js";
import { convertDocument } from "./documents.js";
import assert from "node:assert/strict";
import { agentPreferencesSchema } from "@nervekit/contracts/agent-configuration";
import { join } from "node:path";
import { withFileMutation } from "../../../storage-bootstrap/file-mutations.js";
import {
  releasedDocumentConverters,
  sha256,
  jsonBytes,
  type ConversionContext,
  type Data,
} from "./released-format.js";
import {
  applyExport,
  prepareExport,
  verifyExport,
  retireExportSources,
  convertedTrust,
  exportReceiptSchema,
  exportedTarget,
  type ExportIO,
  type ExportReceipt,
  type OriginalTrust,
} from "./released-export.js";

export interface ProjectMigrationOptions {
  home: string;
  directory(projectId: string): string;
  io: ExportIO;
  discover(
    directory: string,
    inputs: Data[],
  ): Promise<ConversionContext["skillSources"]>;
  originalTrust(projectId: string): OriginalTrust[];
  /** Synchronous transaction, source-bound and idempotent; never grants new consent. */
  commitTrust(
    projectId: string,
    original: OriginalTrust[],
    decisions: ReturnType<typeof convertedTrust>[],
    createdAt: string,
  ): void;
  report(projectId: string, messages: string[]): void;
}
interface ProjectReceipt {
  createdAt: string;
  lowerDigest: string;
  receipt: ExportReceipt;
  trust: ReturnType<typeof convertedTrust>[];
  originalTrust: OriginalTrust[];
}
async function locked<T>(paths: string[], run: () => Promise<T>): Promise<T> {
  const [path, ...rest] = paths;
  return path === undefined
    ? run()
    : withFileMutation(path, () => locked(rest, run));
}
/** Same registered converter boundary as storage upgrade, invoked before the
 * first project-dependent read/activation. No global-ledger entry is written. */
export class ReleasedProjectMigration {
  private readonly pending = new Map<string, Promise<void>>();
  private readonly complete = new Set<string>();
  private readonly failures = new Map<string, unknown>();
  retry(projectId: string): void {
    for (const key of [...this.complete, ...this.failures.keys()])
      if (key.startsWith(projectId + ":")) {
        this.complete.delete(key);
        this.failures.delete(key);
      }
  }
  constructor(private readonly options: ProjectMigrationOptions) {}
  ensureUser(): Promise<void> {
    return this.ensure("@user");
  }
  retryUser(): void {
    this.retry("@user");
  }
  ensure(projectId: string): Promise<void> {
    const directory =
        projectId === "@user"
          ? this.options.home
          : this.options.directory(projectId),
      key = projectId + ":" + directory;
    if (this.complete.has(key)) return Promise.resolve();
    if (this.failures.has(key)) return Promise.reject(this.failures.get(key));
    const pending = this.pending.get(key);
    if (pending) return pending;
    const task = this.convert(projectId, directory)
      .then(() => {
        this.complete.add(key);
      })
      .catch((cause: unknown) => {
        const error = legacyScopeFailure(
          cause,
          projectId === "@user" ? this.options.home : join(directory, ".nerve"),
          this.options.io,
        );
        this.failures.set(key, error);
        const message =
          error instanceof LegacyScopeError
            ? scopeIssueReport(error.issues).join("; ")
            : error instanceof Error &&
                error.message.includes("skill source identity")
              ? error.message
              : "Project conversion blocked; original documents retained";
        try {
          this.options.report(projectId, [message]);
        } catch {
          /* Preserve original conversion failure. */
        }
        throw error;
      })
      .finally(() => {
        this.pending.delete(key);
      });
    this.pending.set(key, task);
    return task;
  }
  private async convert(projectId: string, directory: string): Promise<void> {
    const { io, home } = this.options,
      root = projectId === "@user" ? home : join(directory, ".nerve");
    const scope = projectId === "@user" ? "user" : "project";
    const lowerBytes =
      scope === "user" ? undefined : io.read(join(home, "config/agent.json"));
    const lower =
      lowerBytes === undefined
        ? {}
        : agentPreferencesSchema.parse(JSON.parse(lowerBytes)).overrides;
    const messages: string[] = [];
    const ctx: ConversionContext = {
      builtins: releasedBuiltins,
      skillSources: {},
      inheritedSettings: lower,
      documentPath: join(root, "config/capabilities.json"),
      report: (message) => messages.push(`${root}/config: ${message}`),
    };
    const input = readReleasedScope(root, io, scope, ctx);
    if (input.issues.length) throw new LegacyScopeError(input.issues);
    const before = input.before;
    let archive = join(
      home,
      "quarantine/settings/project-agent-upgrades",
      sha256(projectId + ":" + directory),
    );
    const sources = [...input.snapshots.keys()];
    const policyPath = join(root, "config/permissions.json"),
      policyBytes = io.read(policyPath);
    if (policyBytes !== undefined) {
      try {
        const policy = JSON.parse(policyBytes);
        if (
          JSON.stringify(convertDocument(policy, "permissions")) !==
          JSON.stringify(policy)
        ) {
          before.permissions = policy;
          sources.push(policyPath);
        }
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
      }
    }
    const previous = io.read(join(archive, "plan.json"));
    if (
      previous !== undefined &&
      io.read(join(archive, "committed.json")) !== undefined
    ) {
      const original = (JSON.parse(previous) as ProjectReceipt).receipt;
      if (
        sources.some(
          (path) => original.sources[path]?.digest !== sha256(io.read(path)!),
        )
      )
        archive = join(
          archive,
          "attempts",
          sha256(
            JSON.stringify(
              sources.map((path) => [path, sha256(io.read(path)!)]),
            ),
          ),
        );
    }
    const receiptPath = join(archive, "receipt.json"),
      planPath = join(archive, "plan.json"),
      marker = join(archive, "committed.json");
    if (
      !sources.length &&
      (io.read(planPath) === undefined || io.read(marker) !== undefined)
    )
      return;
    let plan: ProjectReceipt;
    const saved = io.read(planPath);
    if (saved !== undefined) {
      plan = JSON.parse(saved) as ProjectReceipt;
      exportReceiptSchema.parse(plan.receipt);
    } else {
      const bytes = Object.fromEntries(
        sources.map((path) => [path, io.read(path)!]),
      );
      ctx.skillSources = await this.options.discover(directory, [before]);
      validateReleasedCatalog(input, root, scope, ctx);
      if (input.issues.length) throw new LegacyScopeError(input.issues);
      const converted = releasedDocumentConverters.preferences(
        { ...before, scope },
        ctx,
      );
      const targets = releasedScopeTargets(root, scope, before, ctx, converted);
      if (before.permissions) {
        targets[join(root, "config/permissions.json")] = exportedTarget(
          "metadata",
          convertDocument(before.permissions, "permissions"),
        );
        messages.push(
          join(root, "config/permissions.json") +
            ": converted planning tool selectors",
        );
      }
      for (const [path, original] of Object.entries(bytes))
        assert.equal(
          io.read(path),
          original,
          "Project source changed during discovery",
        );
      const originalTrust =
        scope === "user" ? [] : this.options.originalTrust(projectId);
      const receipt = prepareExport(io, {
        identity: "project:" + keyFor(projectId, directory),
        backupDirectory: archive,
        sources,
        targets,
        retire: sources.filter((path) => !targets[path]),
        report: messages,
      });
      const trust = (scope === "user" ? [] : Object.entries(targets))
        .filter(
          ([path, target]) =>
            ["preferences", "profile"].includes(target.kind) ||
            path === join(root, "config/permissions.json"),
        )
        .map(([path, target]) => {
          const inputs = (
            target.kind === "profile"
              ? ["subagents"]
              : path === join(root, "config/permissions.json")
                ? ["permissions"]
                : ["capabilities", "subagents"]
          )
            .map((name) => ({
              path: join(root, "config", name + ".json"),
              kind:
                name === "subagents"
                  ? "agent_profile"
                  : name === "permissions"
                    ? "project_permissions"
                    : "project_capabilities",
            }))
            .filter((source) => receipt.sources[source.path])
            .map((source) => ({
              ...source,
              projectId,
              digest: receipt.sources[source.path].digest,
            }));
          const decision = convertedTrust(
            originalTrust,
            inputs,
            path,
            target.digest,
            target.kind === "profile"
              ? "agent_profile"
              : path === join(root, "config/permissions.json")
                ? "project_permissions"
                : "project_capabilities",
          );
          decision.projectId = projectId;
          if (decision.report) receipt.report.push(decision.report);
          return decision;
        });
      plan = {
        receipt,
        originalTrust,
        trust,
        createdAt: new Date().toISOString(),
        lowerDigest: sha256(lowerBytes ?? "missing"),
      };
    }
    await locked(
      [
        ...new Set([
          ...Object.keys(plan.receipt.sources),
          ...Object.keys(plan.receipt.targets),
          planPath,
          join(home, "config/agent.json"),
        ]),
      ].sort(),
      async () => {
        if (scope === "project" && io.read(marker) === undefined)
          assert.equal(
            sha256(io.read(join(home, "config/agent.json")) ?? "missing"),
            plan.lowerDigest,
            "User preferences changed during project conversion",
          );
        if (io.read(planPath) === undefined)
          io.write(planPath, jsonBytes(plan));
        if (io.read(marker) === undefined) {
          applyExport(io, receiptPath, plan.receipt);
          verifyExport(io, plan.receipt);
          if (scope === "project")
            this.options.commitTrust(
              projectId,
              plan.originalTrust,
              plan.trust,
              plan.createdAt,
            );
          this.options.report(projectId, plan.receipt.report);
          io.write(
            marker,
            jsonBytes({
              schemaVersion: 1,
              planDigest: sha256(jsonBytes(plan)),
            }),
          );
        }
        // If SQL committed but marker persistence failed, commitTrust verifies its
        // own candidate rows on retry rather than re-granting or overwriting edits.
        retireExportSources(io, plan.receipt);
      },
    );
  }
}
const keyFor = (projectId: string, directory: string) =>
  projectId + ":" + directory;
