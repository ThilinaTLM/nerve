import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import type { AgentRecord } from "@nervekit/contracts/agents";
import type {
  IgnoredPermissionSource,
  PermissionOverlay,
  PermissionOverlayDocument,
  PermissionOverlayOrigin,
  PermissionPolicyConfiguration,
  PermissionRule,
  PermissionRuleSet,
  ProjectPermissionTrust,
} from "@nervekit/contracts/permissions";
import type { ProjectRecord } from "@nervekit/contracts/projects";
import { z } from "zod";
import {
  permissionOverlayDocumentForOriginSchema,
  permissionOverlayForOriginSchema,
  permissionRuleSchema,
  permissionRuleSetSchema,
  projectPermissionTrustSchema,
} from "@nervekit/contracts/permissions";
import {
  builtInPermissionRuleSet,
  builtInPermissionRuleSets,
  composeEffectivePermissionPolicy,
  type EffectivePermissionPolicy,
  type PermissionRootPaths,
} from "@nervekit/tools/policy";
import {
  atomicWriteJson,
  managedOwnerPathSegment,
  type InitializedStorage,
} from "../../infrastructure/storage-bootstrap/index.js";

const trustRecordSchema = z
  .object({
    version: z.literal(1),
    digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    trustedAt: z.string().datetime(),
  })
  .strict();
type TrustRecord = z.infer<typeof trustRecordSchema>;
const TRUST_NAMESPACE = "project-permission-trust";
const TRUST_SCOPE = "global";
const emptyOverlayDocument = (): PermissionOverlayDocument => ({
  schemaVersion: 2,
  overlays: [],
});
const legacyPermissionOverlaySchema = z
  .object({
    schemaVersion: z.literal(1),
    rules: z.array(permissionRuleSchema).max(256),
  })
  .strict();

export interface ResolvedPermissionPolicy {
  policy: EffectivePermissionPolicy;
  roots: PermissionRootPaths;
  selectedRuleSetId: string;
  fallback: boolean;
  diagnostics: string[];
}

export class PermissionPolicyService {
  private readonly queues = new Map<string, Promise<void>>();

  constructor(
    private readonly storage: InitializedStorage,
    private readonly getProject: (projectId: string) => ProjectRecord,
  ) {}

  async resolve(agent: AgentRecord): Promise<ResolvedPermissionPolicy> {
    const project = this.getProject(agent.projectId);
    const subagent = Boolean(agent.parentAgentId);
    const selectedId = subagent
      ? "read_only"
      : agent.mode === "planning"
        ? "planning"
        : (agent.permissionRuleSetId ?? agent.permissionLevel);
    const custom = await this.customRuleSets();
    const diagnostics: string[] = [...custom.diagnostics];
    let selected: PermissionRuleSet | undefined =
      builtInPermissionRuleSets.find(
        (candidate) => candidate.id === selectedId,
      ) ?? custom.available.find((candidate) => candidate.id === selectedId);
    const compatibleMode = agent.mode === "planning" ? "planning" : "coding";
    const selectionValid =
      selected?.enabled === true &&
      (selected.compatibleModes === undefined ||
        selected.compatibleModes.includes(compatibleMode));
    const fallback = !selectionValid;
    if (!selectionValid) {
      diagnostics.push(
        `Permission rule set '${selectedId}' is missing, disabled, malformed, or incompatible; Baseline is active.`,
      );
      selected = builtInPermissionRuleSet("baseline");
    }
    const effectiveSelected = selected ?? builtInPermissionRuleSet("baseline");

    const ignored: IgnoredPermissionSource[] = [];
    const knownRuleSetIds = this.knownRuleSetIds(custom.available);
    const userDocument = await this.loadOverlayDocument(
      "user",
      this.storage.paths.permissionsConfigPath,
      ignored,
      knownRuleSetIds,
    );
    const projectPath = this.projectOverlayPath(project);
    const trust = await this.projectTrust(agent.projectId);
    const projectDocument =
      trust.status === "trusted"
        ? await this.loadOverlayDocument(
            "project",
            projectPath,
            ignored,
            knownRuleSetIds,
          )
        : undefined;
    if (trust.status === "invalid" || trust.status === "untrusted") {
      ignored.push({
        origin: "project",
        path: projectPath,
        reason: trust.reason ?? "Project permission overlay is not trusted.",
      });
    }
    const conversationPath = this.conversationOverlayPath(agent.conversationId);
    const conversationDocument = await this.loadOverlayDocument(
      "conversation",
      conversationPath,
      ignored,
      knownRuleSetIds,
    );
    diagnostics.push(...ignored.map((item) => `${item.path}: ${item.reason}`));
    const overlaysEnabled = !subagent && !fallback;
    return {
      policy: composeEffectivePermissionPolicy({
        selectedRuleSet: effectiveSelected,
        ...(overlaysEnabled
          ? {
              userOverlay: overlayForRuleSet(
                userDocument,
                effectiveSelected.id,
              ),
              projectOverlay: overlayForRuleSet(
                projectDocument,
                effectiveSelected.id,
              ),
              conversationOverlay: overlayForRuleSet(
                conversationDocument,
                effectiveSelected.id,
              ),
            }
          : {}),
        ignoredOverlays: subagent ? [] : ignored,
        subagent,
      }),
      roots: {
        project: project.dir,
        nerve_home: this.storage.paths.home,
        nerve_data: this.storage.paths.dataPath,
        plans: this.storage.paths.plansPath,
      },
      selectedRuleSetId: effectiveSelected.id,
      fallback,
      diagnostics,
    };
  }

  async configuration(
    projectId: string,
    conversationId?: string,
  ): Promise<PermissionPolicyConfiguration> {
    const custom = await this.customRuleSets();
    const knownRuleSetIds = this.knownRuleSetIds(custom.available);
    const ignored: IgnoredPermissionSource[] = [];
    const userOverlays =
      (await this.loadOverlayDocument(
        "user",
        this.storage.paths.permissionsConfigPath,
        ignored,
        knownRuleSetIds,
      )) ?? emptyOverlayDocument();
    const project = this.getProject(projectId);
    const projectOverlays =
      (await this.loadOverlayDocument(
        "project",
        this.projectOverlayPath(project),
        ignored,
        knownRuleSetIds,
      )) ?? emptyOverlayDocument();
    const conversationOverlays = conversationId
      ? ((await this.loadOverlayDocument(
          "conversation",
          this.conversationOverlayPath(conversationId),
          ignored,
          knownRuleSetIds,
        )) ?? emptyOverlayDocument())
      : undefined;
    const availableRuleSets = [
      ...builtInPermissionRuleSets,
      ...custom.available,
    ];
    const referencedIds = new Set(
      [userOverlays, projectOverlays, conversationOverlays]
        .flatMap((document) => document?.overlays ?? [])
        .map((overlay) => overlay.ruleSetId),
    );
    const unavailableIds = [...referencedIds]
      .filter((id) => !availableRuleSets.some((ruleSet) => ruleSet.id === id))
      .sort();
    return {
      ruleSets: [
        ...availableRuleSets.map((ruleSet) => ({
          id: ruleSet.id,
          name: ruleSet.name,
          description: ruleSet.description,
          source: ruleSet.source,
          enabled: ruleSet.enabled,
          compatibleModes: ruleSet.compatibleModes,
          available: true,
        })),
        ...unavailableIds.map((id) => ({
          id,
          name: id,
          source: "user" as const,
          enabled: false,
          available: false,
          diagnostic: "The referenced permission rule set is unavailable.",
        })),
      ],
      userOverlays,
      projectOverlays,
      ...(conversationOverlays ? { conversationOverlays } : {}),
      projectTrust: await this.projectTrust(projectId),
      diagnostics: [
        ...custom.diagnostics,
        ...ignored.map((item) => `${item.path}: ${item.reason}`),
      ],
    };
  }

  async customRuleSets(): Promise<{
    available: PermissionRuleSet[];
    diagnostics: string[];
  }> {
    const directory = join(this.storage.paths.configPath, "rule-sets");
    const names = await readdir(directory).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
      },
    );
    const parsed: Array<{ path: string; ruleSet: PermissionRuleSet }> = [];
    const diagnostics: string[] = [];
    for (const name of names
      .filter((entry) => entry.endsWith(".json"))
      .sort()) {
      const path = join(directory, name);
      try {
        const ruleSet = permissionRuleSetSchema.parse(
          JSON.parse(await readFile(path, "utf8")),
        );
        if (ruleSet.source !== "user")
          throw new Error("Custom rule sets must declare source 'user'.");
        if (basename(name, ".json") !== ruleSet.id)
          throw new Error("File name must match the rule-set ID.");
        parsed.push({ path, ruleSet });
      } catch (error) {
        diagnostics.push(`${path}: ${errorMessage(error)}`);
      }
    }
    const counts = new Map<string, number>();
    for (const { ruleSet } of parsed)
      counts.set(ruleSet.id, (counts.get(ruleSet.id) ?? 0) + 1);
    const available = parsed.flatMap(({ path, ruleSet }) => {
      if ((counts.get(ruleSet.id) ?? 0) === 1) return [ruleSet];
      diagnostics.push(
        `${path}: duplicate custom rule-set ID '${ruleSet.id}'.`,
      );
      return [];
    });
    return { available, diagnostics };
  }

  async readOverlay(
    origin: PermissionOverlayOrigin,
    ruleSetId: string,
    ownerId?: string,
  ): Promise<PermissionOverlay> {
    const document = await this.readOverlayDocument(origin, ownerId);
    return overlayForRuleSet(document, ruleSetId) ?? { ruleSetId, rules: [] };
  }

  async replaceOverlay(
    origin: PermissionOverlayOrigin,
    overlay: PermissionOverlay,
    ownerId?: string,
  ): Promise<PermissionOverlay> {
    const parsed = permissionOverlayForOriginSchema(origin).parse(overlay);
    return this.exclusive(`${origin}:${ownerId ?? "global"}`, async () => {
      const current = await this.readOverlayDocument(origin, ownerId);
      await this.writeOverlayDocument(
        origin,
        replaceOverlayGroup(current, parsed),
        ownerId,
      );
      return parsed;
    });
  }

  async saveRule(
    origin: PermissionOverlayOrigin,
    ruleSetId: string,
    rule: PermissionRule,
    ownerId?: string,
  ): Promise<PermissionOverlay> {
    return this.exclusive(`${origin}:${ownerId ?? "global"}`, async () => {
      const currentDocument = await this.readOverlayDocument(origin, ownerId);
      const current = overlayForRuleSet(currentDocument, ruleSetId) ?? {
        ruleSetId,
        rules: [],
      };
      const canonical = canonicalMatcher(rule);
      const duplicate = current.rules.findIndex(
        (candidate) =>
          candidate.enforcement === rule.enforcement &&
          canonicalMatcher(candidate) === canonical,
      );
      let remaining = current.rules.filter((_, index) => index !== duplicate);
      const desiredEnforcement =
        origin === "user" ? rule.enforcement : "overridable";
      const sameClass = remaining.filter(
        (candidate) => candidate.enforcement === desiredEnforcement,
      );
      let priority =
        Math.max(-1_000, ...sameClass.map((item) => item.priority), -1) + 1;
      if (priority > 1_000) {
        const ordered = [...sameClass].sort(
          (left, right) =>
            left.priority - right.priority || left.id.localeCompare(right.id),
        );
        const normalized = new Map(
          ordered.map((candidate, index) => [candidate.id, -1_000 + index]),
        );
        remaining = remaining.map((candidate) => ({
          ...candidate,
          priority: normalized.get(candidate.id) ?? candidate.priority,
        }));
        priority = -1_000 + ordered.length;
      }
      const saved: PermissionRule = {
        ...rule,
        priority,
        enforcement: desiredEnforcement,
      };
      const parsed = permissionOverlayForOriginSchema(origin).parse({
        ruleSetId,
        rules: [...remaining, saved],
      });
      await this.writeOverlayDocument(
        origin,
        replaceOverlayGroup(currentDocument, parsed),
        ownerId,
      );
      return parsed;
    });
  }

  async projectTrust(projectId: string): Promise<ProjectPermissionTrust> {
    const project = this.getProject(projectId);
    const path = this.projectOverlayPath(project);
    let content: string;
    try {
      content = await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { status: "missing" };
      }
      throw error;
    }
    let digest: string;
    try {
      parseOverlayDocument("project", content, []);
      digest = digestContent(content);
    } catch (error) {
      return {
        status: "invalid",
        reason: errorMessage(error),
      };
    }
    const trusted = await this.readTrustRecord(projectId);
    if (!trusted || trusted.digest !== digest) {
      return {
        status: "untrusted",
        digest,
        trustedDigest: trusted?.digest,
        trustedAt: trusted?.trustedAt,
        reason: "The project permission overlay content has not been trusted.",
      };
    }
    return projectPermissionTrustSchema.parse({
      status: "trusted",
      digest,
      trustedDigest: trusted.digest,
      trustedAt: trusted.trustedAt,
    });
  }

  async trustProject(projectId: string): Promise<ProjectPermissionTrust> {
    const project = this.getProject(projectId);
    const path = this.projectOverlayPath(project);
    const content = await readFile(path, "utf8");
    parseOverlayDocument("project", content, []);
    const digest = digestContent(content);
    await this.exclusive(`project-trust:${projectId}`, async () => {
      const current = await this.storage.canonicalStore.readDocument(
        TRUST_NAMESPACE,
        TRUST_SCOPE,
        projectId,
      );
      await this.storage.canonicalStore.writeDocument({
        namespace: TRUST_NAMESPACE,
        scopeId: TRUST_SCOPE,
        documentId: projectId,
        data: {
          version: 1 as const,
          digest,
          trustedAt: new Date().toISOString(),
        },
        expectedRevision: current?.revision ?? 0,
      });
    });
    return this.projectTrust(projectId);
  }

  async revokeProjectTrust(projectId: string): Promise<void> {
    await this.exclusive(`project-trust:${projectId}`, async () => {
      await this.storage.canonicalStore.deleteDocument(
        TRUST_NAMESPACE,
        TRUST_SCOPE,
        projectId,
      );
    });
  }

  private knownRuleSetIds(custom: readonly PermissionRuleSet[]): string[] {
    return [...builtInPermissionRuleSets, ...custom]
      .map((ruleSet) => ruleSet.id)
      .filter((id, index, ids) => ids.indexOf(id) === index)
      .sort();
  }

  private async readOverlayDocument(
    origin: PermissionOverlayOrigin,
    ownerId?: string,
  ): Promise<PermissionOverlayDocument> {
    const ignored: IgnoredPermissionSource[] = [];
    const custom = await this.customRuleSets();
    return (
      (await this.loadOverlayDocument(
        origin,
        this.overlayPath(origin, ownerId),
        ignored,
        this.knownRuleSetIds(custom.available),
      )) ?? emptyOverlayDocument()
    );
  }

  private async writeOverlayDocument(
    origin: PermissionOverlayOrigin,
    document: PermissionOverlayDocument,
    ownerId?: string,
  ): Promise<void> {
    const parsed =
      permissionOverlayDocumentForOriginSchema(origin).parse(document);
    await atomicWriteJson(this.overlayPath(origin, ownerId), parsed, 0o600);
    if (origin === "project") {
      if (!ownerId) throw new Error("Project ID is required.");
      await this.trustProject(ownerId);
    }
  }

  private async loadOverlayDocument(
    origin: PermissionOverlayOrigin,
    path: string,
    ignored: IgnoredPermissionSource[],
    knownRuleSetIds: readonly string[],
  ): Promise<PermissionOverlayDocument | undefined> {
    try {
      return parseOverlayDocument(
        origin,
        await readFile(path, "utf8"),
        knownRuleSetIds,
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      ignored.push({ origin, path, reason: errorMessage(error) });
      return undefined;
    }
  }

  private overlayPath(
    origin: PermissionOverlayOrigin,
    ownerId?: string,
  ): string {
    if (origin === "user") return this.storage.paths.permissionsConfigPath;
    if (!ownerId) throw new Error(`${origin} overlay owner ID is required.`);
    if (origin === "conversation") return this.conversationOverlayPath(ownerId);
    return this.projectOverlayPath(this.getProject(ownerId));
  }

  private projectOverlayPath(project: ProjectRecord): string {
    return join(project.dir, ".nerve", "config", "permissions.json");
  }

  private conversationOverlayPath(conversationId: string): string {
    return join(
      this.storage.paths.conversationsPath,
      managedOwnerPathSegment(conversationId, "conv_"),
      "permissions.json",
    );
  }

  private async readTrustRecord(
    projectId: string,
  ): Promise<TrustRecord | undefined> {
    const document = await this.storage.canonicalStore.readDocument<unknown>(
      TRUST_NAMESPACE,
      TRUST_SCOPE,
      projectId,
    );
    if (!document) return undefined;
    const parsed = trustRecordSchema.safeParse(document.data);
    return parsed.success ? parsed.data : undefined;
  }

  private exclusive<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(key) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(operation);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.queues.set(key, tail);
    return result.finally(() => {
      if (this.queues.get(key) === tail) this.queues.delete(key);
    });
  }
}

function parseOverlayDocument(
  origin: PermissionOverlayOrigin,
  content: string,
  knownRuleSetIds: readonly string[],
): PermissionOverlayDocument {
  const value: unknown = JSON.parse(content);
  const current =
    permissionOverlayDocumentForOriginSchema(origin).safeParse(value);
  if (current.success) return current.data;

  const legacy = legacyPermissionOverlaySchema.parse(value);
  permissionOverlayForOriginSchema(origin).parse({
    ruleSetId: "baseline",
    rules: legacy.rules,
  });
  return permissionOverlayDocumentForOriginSchema(origin).parse({
    schemaVersion: 2,
    overlays: [...new Set(knownRuleSetIds)].sort().map((ruleSetId) => ({
      ruleSetId,
      rules: legacy.rules,
    })),
  });
}

function overlayForRuleSet(
  document: PermissionOverlayDocument | undefined,
  ruleSetId: string,
): PermissionOverlay | undefined {
  return document?.overlays.find((overlay) => overlay.ruleSetId === ruleSetId);
}

function replaceOverlayGroup(
  document: PermissionOverlayDocument,
  overlay: PermissionOverlay,
): PermissionOverlayDocument {
  const overlays = document.overlays.filter(
    (candidate) => candidate.ruleSetId !== overlay.ruleSetId,
  );
  if (overlay.rules.length > 0) overlays.push(overlay);
  overlays.sort((left, right) => left.ruleSetId.localeCompare(right.ruleSetId));
  return { schemaVersion: 2, overlays };
}

function digestContent(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function canonicalMatcher(rule: PermissionRule): string {
  return JSON.stringify({
    enforcement: rule.enforcement,
    when: sort(rule.when),
  });
}

function sort(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sort);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sort(child)]),
    );
  }
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
