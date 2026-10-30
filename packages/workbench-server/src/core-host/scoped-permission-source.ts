import { ProjectMigrationService } from "../infrastructure/configuration/project-migration/project-migration.js";
import { projectMigrationTrust } from "../infrastructure/configuration/project-migration/project-migration-trust.js";
import {
  projectPermissionsConfiguration,
  projectPermissionValue,
} from "./project-permission-migrations.js";
import { readFile, readdir } from "node:fs/promises";
import { join, basename } from "node:path";
import type { CoreStorage } from "@nervekit/conversation-core";
import { supervisionSchema } from "@nervekit/contracts/core";
import type { ConfigurationDiagnostic } from "../infrastructure/configuration/agent-configuration/document-adapters.js";
import {
  permissionRuleSetSchema,
  permissionOverlayDocumentForOriginSchema,
  type PermissionOverlayDocument,
} from "@nervekit/contracts/permissions";
import { toolNameSchema } from "@nervekit/contracts/tools";
import {
  composeEffectivePermissionPolicy,
  evaluatePermissionRequest,
  normalizePermissionRequest,
  builtInPermissionRuleSets,
} from "@nervekit/tools/policy";
import { classifyToolRisk } from "@nervekit/tools/catalog";
import type { AgentConfigurationService } from "../infrastructure/configuration/agent-configuration/agent-configuration-service.js";
import {
  canonicalDigest,
  type AdmissionPolicySource,
  type CurrentPolicy,
} from "./execution-admission/admission.js";
import { emptyOverlayDocument, overlayDigest } from "./permission-overlays.js";

type Loaded =
  | { kind: "missing" }
  | { kind: "bytes"; bytes: string }
  | { kind: "error" };

class PolicyDocumentError extends Error {
  constructor(readonly policyPath: string) {
    super("Invalid permission document");
  }
}

export interface ScopedPermissionPolicySource extends AdmissionPolicySource {
  validateChildPermission(id: string): Promise<void>;
  /** Explicit disk publication, separate from in-memory policy re-evaluation. */
  reload(paths?: readonly string[]): Promise<void>;
}

/** Lazy policy authority. Files are cached until an application save or explicit health reload. */
export function createScopedPermissionSource(options: {
  home: string;
  projectMigration?: ProjectMigrationService;
  storage: CoreStorage;
  agents: AgentConfigurationService;
  trustGeneration(): number;
  requestGenerations(id: string): Record<string, number> | undefined;
}): ScopedPermissionPolicySource {
  const migrations =
    options.projectMigration ??
    new ProjectMigrationService({
      home: options.home,
      trust: projectMigrationTrust(() => options.storage, {
        "permission-overlay": "project_permissions",
      }),
    });
  migrations.register(projectPermissionsConfiguration);
  let epoch = 0;
  const normalized = new WeakMap<
    Parameters<AdmissionPolicySource["ensureLoaded"]>[0],
    ReturnType<typeof normalizePermissionRequest>
  >();
  const files = new Map<string, Promise<Loaded>>();
  let catalog:
    | Promise<{ values: typeof builtInPermissionRuleSets; invalid: string[] }>
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
      pending = readFile(path, "utf8").then(
        (bytes): Loaded => ({ kind: "bytes", bytes }),
        (error: NodeJS.ErrnoException): Loaded =>
          error.code === "ENOENT" ? { kind: "missing" } : { kind: "error" },
      );
      files.set(path, pending);
    }
    return pending;
  };
  const rules = () =>
    (catalog ??= (async () => {
      const directory = join(options.home, "config", "rule-sets");
      const names = await readdir(directory).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return [];
          throw error;
        },
      );
      const values = [...builtInPermissionRuleSets];
      const invalid: string[] = [];
      for (const name of names.filter((name) => name.endsWith(".json"))) {
        const path = join(directory, name);
        const loaded = await read(path);
        try {
          if (loaded.kind !== "bytes") throw new Error("Unreadable ruleset");
          values.push(permissionRuleSetSchema.parse(JSON.parse(loaded.bytes)));
        } catch {
          invalid.push(path);
        }
      }
      return { values, invalid };
    })());
  function blocked(
    path: string,
    code: string,
    conversationId: string,
  ): CurrentPolicy {
    const scope = path.startsWith(join(options.home, "config"))
      ? "user"
      : path.startsWith(join(options.home, "data", "conversations"))
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
            recoveryChoices: ["retry", "reload", "repair"],
          },
        ],
      },
    };
  }
  const trustIdentity = (projectId: string, path: string) =>
    options.storage.trustedResources.find(
      "project_permissions",
      projectId,
      path,
    ) ?? null;
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
    async reload(paths) {
      source.invalidate();
      if (!paths) {
        files.clear();
        catalog = undefined;
      } else {
        for (const path of paths) files.delete(path);
        if (
          paths.some((path) =>
            path.startsWith(join(options.home, "config", "rule-sets")),
          )
        )
          catalog = undefined;
      }
      // Shared per-path promises publish exactly one generation for all conversations.
      if (paths) await Promise.all(paths.map(read));
    },
    async ensureLoaded(input) {
      while (true) {
        const trustVersion = options.trustGeneration();
        const context = projectOf(input.conversationId);
        normalized.set(
          input,
          normalizePermissionRequest({
            toolName: toolNameSchema.parse(input.toolName),
            args: input.args as Record<string, unknown>,
            conversationId: input.conversationId,
            projectId: context.project.id,
            cwd: input.cwd,
            roots: {
              project: context.project.directory,
              nerve_home: options.home,
              nerve_data: join(options.home, "data"),
              plans: join(options.home, "data", "plans"),
            },
          }),
        );

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
        const trust = trustIdentity(project.id, paths.project);
        const trustDigest = canonicalDigest(trust);
        let result: CurrentPolicy;
        try {
          if (
            projectOverlay.classification === "corrupted" ||
            projectOverlay.classification === "incompatible"
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
          if (invalidSelected || !selected) {
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
              if (origin === "project" && trust?.status !== "trusted") continue;
              const loaded = await read(paths[origin]);
              if (
                origin === "project" &&
                loaded.kind === "bytes" &&
                overlayDigest(loaded.bytes) !== trust?.contentDigest
              )
                continue;
              try {
                if (loaded.kind === "error")
                  throw new Error("Unreadable policy");
                documents[origin] =
                  loaded.kind === "missing"
                    ? emptyOverlayDocument()
                    : origin === "project"
                      ? projectPermissionValue(JSON.parse(loaded.bytes))
                      : permissionOverlayDocumentForOriginSchema(origin).parse(
                          JSON.parse(loaded.bytes),
                        );
              } catch {
                throw new PolicyDocumentError(paths[origin]);
              }
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
                const evaluated = evaluatePermissionRequest({
                  policy,
                  request,
                });
                return supervisionSchema.parse({
                  decision:
                    evaluated.decision === "prompt"
                      ? "approval"
                      : evaluated.decision,
                  effectiveRisk: classifyToolRisk(
                    actual.toolName,
                    request.args,
                  ),
                  reason: evaluated.reason,
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
            error instanceof PolicyDocumentError
              ? String(error.policyPath)
              : join(options.home, "config", "rule-sets");
          result = blocked(path, "invalid-policy", conversation.id);
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
