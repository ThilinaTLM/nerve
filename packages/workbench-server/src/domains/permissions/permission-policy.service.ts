import { createHash } from "node:crypto";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import type { AgentRecord } from "@nervekit/contracts/agents";
import type {
  IgnoredPermissionSource,
  PermissionOverlay,
  PermissionOverlayOrigin,
  PermissionPolicyConfiguration,
  PermissionRule,
  PermissionRuleSet,
  ProjectPermissionTrust,
} from "@nervekit/contracts/permissions";
import type { ProjectRecord } from "@nervekit/contracts/projects";
import {
  permissionOverlayForOriginSchema,
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

interface TrustRecord {
  digest: string;
  trustedAt: string;
}
interface TrustStore {
  version: 1;
  projects: Record<string, TrustRecord>;
}

export interface ResolvedPermissionPolicy {
  policy: EffectivePermissionPolicy;
  roots: PermissionRootPaths;
  selectedRuleSetId: string;
  fallback: boolean;
  diagnostics: string[];
}

export class PermissionPolicyService {
  private readonly queues = new Map<string, Promise<void>>();
  private readonly trustPath: string;

  constructor(
    private readonly storage: InitializedStorage,
    private readonly getProject: (projectId: string) => ProjectRecord,
  ) {
    this.trustPath = join(
      storage.paths.dataPath,
      "permissions",
      "project-trust.json",
    );
  }

  async resolve(agent: AgentRecord): Promise<ResolvedPermissionPolicy> {
    const project = this.getProject(agent.projectId);
    const subagent = Boolean(agent.parentAgentId);
    const selectedId = subagent
      ? "read_only"
      : agent.mode === "planning"
        ? "planning"
        : (agent.permissionRuleSetId ?? agent.permissionLevel);
    const diagnostics: string[] = [];
    let selected: PermissionRuleSet | undefined =
      builtInPermissionRuleSets.find(
        (candidate) => candidate.id === selectedId,
      );
    if (!selected) {
      const custom = await this.customRuleSets();
      selected = custom.available.find(
        (candidate) => candidate.id === selectedId,
      );
      diagnostics.push(...custom.diagnostics);
    }
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
    const user = await this.loadOverlay(
      "user",
      this.storage.paths.permissionsConfigPath,
      ignored,
    );
    const projectPath = this.projectOverlayPath(project);
    const trust = await this.projectTrust(agent.projectId);
    const projectOverlay =
      trust.status === "trusted"
        ? await this.loadOverlay("project", projectPath, ignored)
        : undefined;
    if (trust.status === "invalid" || trust.status === "untrusted") {
      ignored.push({
        origin: "project",
        path: projectPath,
        reason: trust.reason ?? "Project permission overlay is not trusted.",
      });
    }
    const conversationPath = this.conversationOverlayPath(agent.conversationId);
    const conversation = await this.loadOverlay(
      "conversation",
      conversationPath,
      ignored,
    );
    diagnostics.push(...ignored.map((item) => `${item.path}: ${item.reason}`));
    return {
      policy: composeEffectivePermissionPolicy({
        selectedRuleSet: effectiveSelected,
        ...(subagent
          ? {}
          : {
              userOverlay: user,
              projectOverlay,
              conversationOverlay: conversation,
            }),
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
    const ignored: IgnoredPermissionSource[] = [];
    const userOverlay = (await this.loadOverlay(
      "user",
      this.storage.paths.permissionsConfigPath,
      ignored,
    )) ?? { schemaVersion: 1 as const, rules: [] };
    const project = this.getProject(projectId);
    const projectOverlay = (await this.loadOverlay(
      "project",
      this.projectOverlayPath(project),
      ignored,
    )) ?? { schemaVersion: 1 as const, rules: [] };
    const conversationOverlay = conversationId
      ? ((await this.loadOverlay(
          "conversation",
          this.conversationOverlayPath(conversationId),
          ignored,
        )) ?? { schemaVersion: 1 as const, rules: [] })
      : undefined;
    return {
      ruleSets: [
        ...builtInPermissionRuleSets.map((ruleSet) => ({
          id: ruleSet.id,
          name: ruleSet.name,
          description: ruleSet.description,
          source: ruleSet.source,
          enabled: ruleSet.enabled,
          compatibleModes: ruleSet.compatibleModes,
          available: true,
        })),
        ...custom.available.map((ruleSet) => ({
          id: ruleSet.id,
          name: ruleSet.name,
          description: ruleSet.description,
          source: ruleSet.source,
          enabled: ruleSet.enabled,
          compatibleModes: ruleSet.compatibleModes,
          available: true,
        })),
      ],
      userOverlay,
      projectOverlay,
      ...(conversationOverlay ? { conversationOverlay } : {}),
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
    ownerId?: string,
  ): Promise<PermissionOverlay> {
    const path = this.overlayPath(origin, ownerId);
    const ignored: IgnoredPermissionSource[] = [];
    return (
      (await this.loadOverlay(origin, path, ignored)) ?? {
        schemaVersion: 1,
        rules: [],
      }
    );
  }

  async replaceOverlay(
    origin: PermissionOverlayOrigin,
    overlay: PermissionOverlay,
    ownerId?: string,
  ): Promise<PermissionOverlay> {
    const parsed = permissionOverlayForOriginSchema(origin).parse(overlay);
    const path = this.overlayPath(origin, ownerId);
    return this.exclusive(`${origin}:${ownerId ?? "global"}`, async () => {
      await atomicWriteJson(path, parsed, 0o600);
      if (origin === "project") {
        if (!ownerId) throw new Error("Project ID is required.");
        await this.trustProject(ownerId);
      }
      return parsed;
    });
  }

  async saveRule(
    origin: PermissionOverlayOrigin,
    rule: PermissionRule,
    ownerId?: string,
  ): Promise<PermissionOverlay> {
    return this.exclusive(`${origin}:${ownerId ?? "global"}`, async () => {
      const current = await this.readOverlay(origin, ownerId);
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
        schemaVersion: 1,
        rules: [...remaining, saved],
      });
      await atomicWriteJson(this.overlayPath(origin, ownerId), parsed, 0o600);
      if (origin === "project") {
        if (!ownerId) throw new Error("Project ID is required.");
        await this.trustProject(ownerId);
      }
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
      permissionOverlayForOriginSchema("project").parse(JSON.parse(content));
      digest = digestContent(content);
    } catch (error) {
      return {
        status: "invalid",
        reason: errorMessage(error),
      };
    }
    const trusted = (await this.readTrustStore()).projects[projectId];
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
    permissionOverlayForOriginSchema("project").parse(JSON.parse(content));
    const digest = digestContent(content);
    await this.exclusive("project-trust", async () => {
      const store = await this.readTrustStore();
      store.projects[projectId] = {
        digest,
        trustedAt: new Date().toISOString(),
      };
      await atomicWriteJson(this.trustPath, store, 0o600);
    });
    return this.projectTrust(projectId);
  }

  async revokeProjectTrust(projectId: string): Promise<void> {
    await this.exclusive("project-trust", async () => {
      const store = await this.readTrustStore();
      delete store.projects[projectId];
      await atomicWriteJson(this.trustPath, store, 0o600);
    });
  }

  private async loadOverlay(
    origin: PermissionOverlayOrigin,
    path: string,
    ignored: IgnoredPermissionSource[],
  ): Promise<PermissionOverlay | undefined> {
    try {
      const content = await readFile(path, "utf8");
      return permissionOverlayForOriginSchema(origin).parse(
        JSON.parse(content),
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

  private async readTrustStore(): Promise<TrustStore> {
    try {
      const raw = JSON.parse(
        await readFile(this.trustPath, "utf8"),
      ) as TrustStore;
      if (raw.version !== 1 || typeof raw.projects !== "object")
        throw new Error("Invalid project permission trust store.");
      return raw;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        await mkdir(join(this.storage.paths.dataPath, "permissions"), {
          recursive: true,
          mode: 0o700,
        });
        return { version: 1, projects: {} };
      }
      throw error;
    }
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
