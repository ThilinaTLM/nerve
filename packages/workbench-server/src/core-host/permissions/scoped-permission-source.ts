import { ProjectMigrationService } from "../../infrastructure/configuration/project-migration/project-migration.js";
import { projectMigrationTrust } from "../../infrastructure/configuration/project-migration/project-migration-trust.js";
import { projectPermissionsConfiguration } from "./project-permission-migrations.js";
import {
  identifyPermissionFile,
  parsePermissionFile,
  readPermissionFile,
  ruleSetDirectory,
  type LoadedPermissionFile,
  type PermissionFileReport,
} from "./permission-files.js";
import { permissionFileWarnings } from "./permission-warnings.js";
import { readdir } from "node:fs/promises";
import { join, basename } from "node:path";
import { isPathInside } from "@nervekit/tools/execution";
import type {
  CoreStorage,
  TrustedResourceService,
} from "@nervekit/conversation-core";
import { supervisionSchema } from "@nervekit/contracts/core";
import type { ConfigurationDiagnostic } from "../../infrastructure/configuration/agent-configuration/document-adapters.js";
import type { PermissionOverlayDocument } from "@nervekit/contracts/permissions";
import { activeToolNameSchema } from "@nervekit/contracts/tools";
import {
  composeEffectivePermissionPolicy,
  composeScriptAdmission,
  evaluatePermissionRequest,
  normalizeOperationRequest,
  normalizePermissionRequest,
  builtInPermissionRuleSets,
} from "@nervekit/tools/policy";
import {
  allScopedToolNames,
  allToolDescriptors,
  classifyToolRisk,
} from "@nervekit/tools/catalog";
import {
  classifyQuickScriptArguments,
  findQuickScriptNamespace,
  summarizeScannedCalls,
  type QuickScriptRegistry,
} from "@nervekit/tools/quick-script";
import type { AgentConfigurationService } from "../../infrastructure/configuration/agent-configuration/agent-configuration-service.js";
import {
  canonicalDigest,
  type AdmissionPolicySource,
  type CurrentPolicy,
} from "./execution-admission/admission.js";
import { emptyOverlayDocument, overlayDigest } from "./permission-overlays.js";
import {
  extensionIdOf,
  nestedOperation,
  operationEffectiveRisk,
  withScriptOperations,
} from "./scoped-permission-operations.js";
import { hostRegistry } from "../host-tools.js";

class PolicyDocumentError extends Error {
  constructor(readonly policyPath: string) {
    super("Invalid permission document");
  }
}

/** A user permission file that waits for the user's review and has no trusted version to fall back on. */
class PolicyPendingError extends Error {
  constructor(readonly policyPath: string) {
    super("Permission document waits for review");
  }
}

export interface ScopedPermissionPolicySource extends AdmissionPolicySource {
  validateChildPermission(id: string): Promise<void>;
  /**
   * Explicit disk publication, separate from in-memory policy re-evaluation. A file that is
   * invalid on disk never replaces a valid loaded version. Without `paths`: the user overlay,
   * every rule set and every file loaded so far.
   */
  reload(paths?: readonly string[]): Promise<PermissionFileReport[]>;
  /** Validates the files on disk and changes nothing. Without `paths`: the user overlay and every rule set. */
  check(paths?: readonly string[]): Promise<PermissionFileReport[]>;
  /** The same reports for the versions that are loaded (read on first use). */
  loaded(paths?: readonly string[]): Promise<PermissionFileReport[]>;
  /** Ids of the loaded rule sets a conversation can select: built-in and valid, enabled user ones. */
  selectableRuleSetIds(): Promise<string[]>;
}

/** Lazy policy authority. Files are cached until an application save or explicit health reload. */
export function createScopedPermissionSource(options: {
  home: string;
  projectMigration?: ProjectMigrationService;
  storage: CoreStorage;
  trust: Pick<TrustedResourceService, "trustState">;
  agents: AgentConfigurationService;
  trustGeneration(): number;
  requestGenerations(id: string): Record<string, number> | undefined;
  /** The registry of a project's extensions, for the script scan; default: the built-ins'. */
  registryFor?(projectDirectory: string): Promise<QuickScriptRegistry>;
}): ScopedPermissionPolicySource {
  const migrations =
    options.projectMigration ??
    new ProjectMigrationService({
      home: options.home,
      trust: projectMigrationTrust(() => options.storage, {
        "permission-overlay": "permissions",
      }),
    });
  migrations.register(projectPermissionsConfiguration);
  let epoch = 0;
  const normalized = new WeakMap<
    Parameters<AdmissionPolicySource["ensureLoaded"]>[0],
    ReturnType<typeof normalizePermissionRequest>
  >();
  /** The script scan of a `quick_script` request, computed (asynchronously) in `ensureLoaded` and read by the synchronous `evaluate`. */
  const scans = new WeakMap<
    Parameters<AdmissionPolicySource["ensureLoaded"]>[0],
    Awaited<ReturnType<typeof classifyQuickScriptArguments>>
  >();
  /** The extension that contributes each namespace, as the request's project sees it. */
  const namespaceOwners = new WeakMap<
    Parameters<AdmissionPolicySource["ensureLoaded"]>[0],
    (namespace: string) => string | undefined
  >();
  const files = new Map<string, Promise<LoadedPermissionFile>>();
  let catalog:
    | Promise<{
        values: typeof builtInPermissionRuleSets;
        invalid: string[];
        pending: string[];
      }>
    | undefined;
  const policies = new Map<
    string,
    { epoch: number; current(): CurrentPolicy }
  >();
  const projectOf = (id: string) => {
    const conversation = options.storage.conversations.get(id);
    const project =
      conversation && options.storage.projects.get(conversation.projectId);
    if (!conversation || !project)
      throw new Error("Conversation context not found");
    return { conversation, project };
  };
  const read = (path: string) => {
    let pending = files.get(path);
    if (!pending) {
      pending = readPermissionFile(path);
      files.set(path, pending);
    }
    return pending;
  };
  const parse = (path: string, loaded: LoadedPermissionFile) =>
    parsePermissionFile(identifyPermissionFile(options.home, path), loaded);
  /** Rule set files on disk; an unreadable folder throws. */
  const ruleSetPaths = async () => {
    const directory = ruleSetDirectory(options.home);
    const names = await readdir(directory).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
      },
    );
    return names
      .filter((name) => name.endsWith(".json"))
      .sort()
      .map((name) => join(directory, name));
  };
  /**
   * The user's permission files apply only while their exact bytes are trusted. A file that waits
   * keeps the last trusted version this process held in effect, like a file that is invalid on
   * disk; with none (after a restart), the file is `pending` and affected calls are blocked.
   */
  const lastTrusted = new Map<string, LoadedPermissionFile>();
  const userKind = (path: string) =>
    identifyPermissionFile(options.home, path).kind === "rule-set"
      ? ("permission_rule_set" as const)
      : ("permissions" as const);
  const userTrustState = (path: string, file: LoadedPermissionFile) =>
    file.kind === "bytes"
      ? options.trust.trustState(
          options.storage.trustedResources.find(userKind(path), null, path),
          overlayDigest(file.bytes),
        )
      : "trusted";
  const effectiveUser = async (
    path: string,
  ): Promise<{ file: LoadedPermissionFile | undefined; pending: boolean }> => {
    let loaded = await read(path);
    let state = userTrustState(path, loaded);
    if (state !== "trusted" && loaded.kind === "bytes") {
      // The user trusted a version that is not the loaded one: activate it if it is valid.
      const row = options.storage.trustedResources.find(
        userKind(path),
        null,
        path,
      );
      if (
        row?.status === "trusted" &&
        row.contentDigest !== overlayDigest(loaded.bytes)
      ) {
        const fresh = await readPermissionFile(path);
        if (
          userTrustState(path, fresh) === "trusted" &&
          parse(path, fresh).ok
        ) {
          files.set(path, Promise.resolve(fresh));
          loaded = fresh;
          state = "trusted";
        }
      }
    }
    if (state === "trusted") {
      // "No file" is a trusted state too: a file that appears later waits for review.
      lastTrusted.set(path, loaded);
      return { file: loaded, pending: false };
    }
    // An invalid file has nothing to review; it is reported as invalid, like any other.
    if (loaded.kind === "bytes" && !parse(path, loaded).ok)
      return { file: loaded, pending: false };
    return { file: lastTrusted.get(path), pending: true };
  };
  let catalogTrust = -1;
  const rules = () => {
    // A decision changes which rule sets are trusted.
    if (catalogTrust !== options.trustGeneration()) {
      catalog = undefined;
      catalogTrust = options.trustGeneration();
    }
    return (catalog ??= (async () => {
      const values = [...builtInPermissionRuleSets];
      const invalid: string[] = [];
      const pending: string[] = [];
      for (const path of await ruleSetPaths()) {
        const effective = await effectiveUser(path);
        if (!effective.file) {
          pending.push(path);
          continue;
        }
        const parsed = parse(path, effective.file);
        if (parsed.ok && parsed.ruleSet) values.push(parsed.ruleSet);
        else invalid.push(path);
      }
      return { values, invalid, pending };
    })());
  };
  const userOverlayPath = join(options.home, "config", "permissions.json");
  /** The user overlay and every rule set; an unreadable rule-set folder is reported on the folder. */
  const userPaths = async (): Promise<{
    paths: string[];
    folder?: PermissionFileReport;
  }> => {
    try {
      return { paths: [userOverlayPath, ...(await ruleSetPaths())] };
    } catch (error) {
      return {
        paths: [userOverlayPath],
        folder: {
          path: ruleSetDirectory(options.home),
          scope: "user",
          kind: "rule-set",
          document: "rule-sets",
          diagnostics: [
            {
              level: "error",
              code: "io-error",
              message: `The rule-set folder could not be read: ${(error as Error).message}`,
            },
          ],
        },
      };
    }
  };
  const builtinRuleSetIds = new Set(
    builtInPermissionRuleSets.map((entry) => entry.id),
  );
  type Examined = {
    report: PermissionFileReport;
    parsed: ReturnType<typeof parsePermissionFile>;
  };
  const examine = (path: string, candidate: LoadedPermissionFile): Examined => {
    const identity = identifyPermissionFile(options.home, path);
    const parsed = parsePermissionFile(identity, candidate);
    return {
      parsed,
      report: {
        path,
        ...identity,
        diagnostics: parsed.ok ? [] : parsed.diagnostics,
        ...(candidate.kind === "bytes"
          ? { contentDigest: overlayDigest(candidate.bytes) }
          : {}),
        ...(candidate.kind === "missing" ? {} : { exists: true as const }),
        ...(identity.scope === "user" &&
        candidate.kind === "bytes" &&
        userTrustState(path, candidate) !== "trusted" &&
        lastTrusted.has(path)
          ? { previousVersionActive: true as const }
          : {}),
        ...(parsed.ok && parsed.ruleSet
          ? {
              ruleSet: {
                id: parsed.ruleSet.id,
                enabled: parsed.ruleSet.enabled,
              },
            }
          : {}),
      },
    };
  };
  /** Adds the warnings of the files that parsed: mistakes that load cleanly. */
  const withWarnings = async (
    examined: readonly Examined[],
  ): Promise<PermissionFileReport[]> => {
    const loaded = await rules().catch(() => undefined);
    const context = {
      toolNames: new Set([
        ...allToolDescriptors().map((tool) => tool.name),
        ...allScopedToolNames(),
      ]),
      builtinRuleSetIds,
      ruleSetIds: new Set([
        ...(loaded?.values.map((entry) => entry.id) ?? builtinRuleSetIds),
        ...examined.flatMap(({ parsed }) =>
          parsed.ok && parsed.ruleSet ? [parsed.ruleSet.id] : [],
        ),
      ]),
    };
    return examined.map(({ report, parsed }) =>
      parsed.ok
        ? {
            ...report,
            diagnostics: permissionFileWarnings(
              report.path,
              report,
              parsed,
              context,
            ),
          }
        : report,
    );
  };
  function blocked(
    path: string,
    code: string,
    conversationId: string,
  ): CurrentPolicy {
    const waiting = code === "needs-review";
    const scope = isPathInside(join(options.home, "config"), path)
      ? "user"
      : isPathInside(join(options.home, "data", "conversations"), path)
        ? "conversation"
        : "project";
    return {
      kind: "blocked",
      request: {
        diagnostics: [
          {
            scope,
            ...(scope === "conversation" ? { scopeId: conversationId } : {}),
            document: basename(path),
            path,
            code,
            pointer: "",
            affectedCapability: "tool-execution",
            recoveryChoices: waiting
              ? ["retry"]
              : ["retry", "reload", "repair"],
          },
        ],
      },
    };
  }
  const trustIdentity = (projectId: string, path: string) =>
    options.storage.trustedResources.find("permissions", projectId, path) ??
    null;
  const inspect = async (
    paths: readonly string[] | undefined,
    from: (path: string) => Promise<LoadedPermissionFile>,
  ) => {
    const user = paths ? undefined : await userPaths();
    const reports = await withWarnings(
      await Promise.all(
        (paths ?? user!.paths).map(async (path) =>
          examine(path, await from(path)),
        ),
      ),
    );
    return user?.folder ? [...reports, user.folder] : reports;
  };
  const source: ScopedPermissionPolicySource = {
    async validateChildPermission(id) {
      while (true) {
        const version = epoch;
        const definitions = await rules();
        if (version !== epoch) continue;
        const selected = definitions.values.find(
          (entry) => entry.id === id && entry.enabled,
        );
        if (
          !selected ||
          selected.rules.some(
            (rule) => rule.enabled && rule.decision === "prompt",
          )
        )
          throw new Error(`Permission rule set "${id}" is not sub-agent safe`);
        return;
      }
    },
    invalidate() {
      epoch++;
      policies.clear();
    },
    async selectableRuleSetIds() {
      const loaded = await rules().catch(() => undefined);
      return (loaded?.values ?? builtInPermissionRuleSets)
        .filter((entry) => entry.enabled)
        .map((entry) => entry.id);
    },
    check: (paths) => inspect(paths, readPermissionFile),
    loaded: (paths) => inspect(paths, read),
    async reload(paths) {
      const user = paths ? undefined : await userPaths();
      const targets = new Set(paths ?? [...user!.paths, ...files.keys()]);
      const examined = await Promise.all(
        [...targets].map(async (path): Promise<Examined> => {
          const candidate = await readPermissionFile(path);
          const result = examine(path, candidate);
          const loaded = files.get(path);
          // Validate, then activate: an invalid file never replaces a valid loaded version.
          if (!result.parsed.ok && loaded && parse(path, await loaded).ok)
            return {
              ...result,
              report: { ...result.report, previousVersionActive: true },
            };
          // Shared per-path promises publish exactly one generation for all conversations.
          files.set(path, Promise.resolve(candidate));
          return result;
        }),
      );
      catalog = undefined;
      source.invalidate();
      const reports = await withWarnings(examined);
      return user?.folder ? [...reports, user.folder] : reports;
    },
    async ensureLoaded(input) {
      // Composing the project's extensions publishes their direct tools for the request below.
      const registry = options.registryFor
        ? await options.registryFor(
            projectOf(input.conversationId).project.directory,
          )
        : hostRegistry;
      namespaceOwners.set(input, (namespace) => {
        const owner = findQuickScriptNamespace(namespace, registry)?.owner;
        return owner === "runtime" ? undefined : owner;
      });
      if (input.toolName === "quick_script" && !nestedOperation(input))
        scans.set(
          input,
          await classifyQuickScriptArguments(
            input.args as Record<string, unknown>,
            registry,
          ),
        );
      while (true) {
        const trustVersion = options.trustGeneration();
        const context = projectOf(input.conversationId);
        const operation = nestedOperation(input);
        normalized.set(
          input,
          operation
            ? normalizeOperationRequest({
                ...operation,
                ...extensionIdOf(
                  namespaceOwners.get(input),
                  operation.operation,
                ),
                conversationId: input.conversationId,
                projectId: context.project.id,
              })
            : normalizePermissionRequest({
                toolName: activeToolNameSchema.parse(input.toolName),
                args: input.args as Record<string, unknown>,
                conversationId: input.conversationId,
                projectId: context.project.id,
                toolScope: context.project.directory,
                cwd: input.cwd,
                roots: {
                  project: context.project.directory,
                  nerve_home: options.home,
                  nerve_data: join(options.home, "data"),
                  plans: join(options.home, "data", "plans"),
                },
              }),
        );
        const scan = scans.get(input);
        if (scan) normalized.get(input)!.argumentRisk = scan.risk;

        const existing = policies.get(input.conversationId);
        if (existing?.epoch === epoch && existing.current().kind !== "stale")
          return;
        const version = epoch;
        const { conversation, project } = context;
        const agent = await options.agents.captureEffective(conversation.id);
        if (agent.view.status !== "available") {
          const diagnostics = agent.view
            .diagnostics as ConfigurationDiagnostic[];
          policies.set(conversation.id, {
            epoch: version,
            current: () =>
              epoch !== version
                ? { kind: "stale" }
                : { kind: "blocked", request: { diagnostics } },
          });
          return;
        }
        const paths = {
          user: join(options.home, "config", "permissions.json"),
          project: join(
            project.directory,
            ".nerve",
            "config",
            "permissions.json",
          ),
          conversation: join(
            options.home,
            "data",
            "conversations",
            conversation.id,
            "config",
            "permissions.json",
          ),
        };
        const projectOverlay = await migrations.load(
          { projectId: project.id, directory: project.directory },
          projectPermissionsConfiguration,
        );
        if (projectOverlay.classification === "migrated")
          files.delete(paths.project);
        // Read whether or not it is trusted, so a later invalid edit has a version to fall back to.
        const projectFile = await read(paths.project);
        const trust = trustIdentity(project.id, paths.project);
        const trustDigest = canonicalDigest(trust);
        let result: CurrentPolicy;
        try {
          // An unusable file on disk blocks only when no valid version is loaded.
          if (
            (projectOverlay.classification === "corrupted" ||
              projectOverlay.classification === "incompatible") &&
            !parse(paths.project, projectFile).ok
          )
            throw new PolicyDocumentError(paths.project);
          const definitions = await rules();
          const selectedId =
            agent.view.resolution.settings.permissionRuleSetId!;
          const selected = definitions.values.find(
            (rule) => rule.id === selectedId && rule.enabled,
          );
          const invalidSelected = definitions.invalid.find(
            (path) => basename(path, ".json") === selectedId,
          );
          const pendingSelected = definitions.pending.find(
            (path) => basename(path, ".json") === selectedId,
          );
          if (pendingSelected && !selected) {
            result = blocked(pendingSelected, "needs-review", conversation.id);
          } else if (invalidSelected || !selected) {
            result = blocked(
              invalidSelected ??
                join(options.home, "config", "rule-sets", `${selectedId}.json`),
              "invalid-selected-ruleset",
              conversation.id,
            );
          } else {
            const documents: Partial<
              Record<keyof typeof paths, PermissionOverlayDocument>
            > = {};
            for (const origin of ["user", "project", "conversation"] as const) {
              let loaded = await read(paths[origin]);
              if (origin === "user") {
                const effective = await effectiveUser(paths.user);
                if (!effective.file) throw new PolicyPendingError(paths.user);
                loaded = effective.file;
              }
              if (origin === "project") {
                // Only the exact trusted bytes apply; a missing file has none to compare.
                const digest =
                  loaded.kind === "bytes"
                    ? overlayDigest(loaded.bytes)
                    : trust?.contentDigest;
                if (
                  !digest ||
                  options.trust.trustState(trust, digest) !== "trusted"
                )
                  continue;
              }
              const parsed = parse(paths[origin], loaded);
              if (!parsed.ok) throw new PolicyDocumentError(paths[origin]);
              documents[origin] = parsed.overlay ?? emptyOverlayDocument();
            }
            const overlay = (origin: keyof typeof paths) =>
              documents[origin]?.overlays.find(
                (entry) => entry.ruleSetId === selectedId,
              );
            const policy = composeEffectivePermissionPolicy({
              selectedRuleSet: selected,
              userOverlay: overlay("user"),
              projectOverlay: overlay("project"),
              conversationOverlay: overlay("conversation"),
            });
            result = {
              kind: "available",
              child: conversation.parentConversationId !== null,
              generations: {
                policy: version,
                trust: trustVersion,
                ...Object.fromEntries(
                  agent.view.sources.map((value) => [
                    `agent:${value.path}`,
                    value.generation,
                  ]),
                ),
              },
              authority: {
                ruleSetId: selected.id,
                policySnapshotHash: policy.snapshotHash,
                trust: trustDigest,
              },
              evaluate(actual) {
                const request = normalized.get(actual);
                if (!request)
                  throw new Error("Permission request was not prepared");
                const scanned =
                  actual.toolName === "quick_script" && !request.operation
                    ? scans.get(actual)
                    : undefined;
                const script = evaluatePermissionRequest({ policy, request });
                // A complete scan lets operation rules decide the script.
                const evaluated =
                  scanned?.admissible === true
                    ? composeScriptAdmission({
                        script,
                        calls: scanned.calls,
                        policy,
                        ...(namespaceOwners.has(actual)
                          ? { extensionOf: namespaceOwners.get(actual)! }
                          : {}),
                        conversationId: request.conversationId,
                        ...(request.projectId === undefined
                          ? {}
                          : { projectId: request.projectId }),
                      }).result
                    : script;
                return supervisionSchema.parse({
                  decision:
                    evaluated.decision === "prompt"
                      ? "approval"
                      : evaluated.decision,
                  effectiveRisk: request.operation
                    ? operationEffectiveRisk(request.args.risk)
                    : scanned
                      ? scanned.risk
                      : classifyToolRisk(
                          actual.toolName,
                          request.args,
                          request.toolScope,
                        ),
                  reason:
                    actual.toolName === "quick_script" &&
                    !request.operation &&
                    evaluated.decision !== "allow"
                      ? withScriptOperations(
                          evaluated.reason,
                          scanned?.operations ?? [],
                        )
                      : evaluated.reason,
                  ...(scanned && scanned.calls.length > 0
                    ? { operations: summarizeScannedCalls(scanned.calls) }
                    : {}),
                  matchedRule: evaluated.winningRule,
                  suggestedRules: evaluated.suggestedRules,
                  authority: {
                    ruleSetId: selected.id,
                    policySnapshotHash: policy.snapshotHash,
                  },
                });
              },
            };
          }
        } catch (error) {
          const path =
            error instanceof PolicyDocumentError ||
            error instanceof PolicyPendingError
              ? String(error.policyPath)
              : join(options.home, "config", "rule-sets");
          result = blocked(
            path,
            error instanceof PolicyPendingError
              ? "needs-review"
              : "invalid-policy",
            conversation.id,
          );
        }
        if (
          version !== epoch ||
          trustVersion !== options.trustGeneration() ||
          !agent.isCurrent()
        )
          continue;
        policies.set(conversation.id, {
          epoch: version,
          current: () =>
            version !== epoch ||
            !agent.isCurrent() ||
            trustVersion !== options.trustGeneration()
              ? { kind: "stale" }
              : result,
        });
        return;
      }
    },
    current(input) {
      return policies.get(input.conversationId)?.current() ?? { kind: "stale" };
    },
    requestGenerations(input) {
      return input.requestCaptureId
        ? (options.requestGenerations(input.requestCaptureId) ?? {})
        : {};
    },
  };
  const publishedHealth = new Map<
    string,
    { signature: string; path: string }
  >();
  migrations.onHealthChanged((health) => {
    const issue = health.issues.find(
      (issue) => issue.type === projectPermissionsConfiguration.id,
    );
    const previous = publishedHealth.get(health.projectId);
    const signature = issue
      ? JSON.stringify([issue.path, issue.classification])
      : "";
    if (signature === (previous?.signature ?? "")) return;
    const path = issue?.path ?? previous?.path;
    if (path) {
      publishedHealth.set(health.projectId, { signature, path });
      // A file that turned unusable keeps the version loaded before it; anything else is re-read.
      if (
        issue?.classification !== "corrupted" &&
        issue?.classification !== "incompatible"
      )
        files.delete(path);
      source.invalidate();
    }
  });
  migrations.onResolved(async (context, type) => {
    if (type.id === projectPermissionsConfiguration.id)
      await source.reload([join(context.directory, ".nerve", type.path)]);
  });
  return source;
}
