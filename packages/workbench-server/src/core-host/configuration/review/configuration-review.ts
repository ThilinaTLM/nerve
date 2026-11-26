import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import {
  agentPreferencesSchema,
  profileDefinitionSchema,
  type AgentScope,
} from "@nervekit/contracts/agent-configuration";
import type {
  ConfigurationReview,
  ConfigurationReviewSource,
  ConfigurationReviewTarget,
  ConfigurationDecision,
} from "@nervekit/contracts/configuration";
import {
  configurationReviewSnapshotSchema,
  toTrustedDigest,
  type TrustState,
  type TrustedResource,
  type TrustedResourceKind,
} from "@nervekit/contracts/core";
import {
  extensionGrantSnapshotSchema,
  type ExtensionCatalogEntry,
} from "@nervekit/contracts/extensions";
import {
  mcpGrantSnapshotSchema,
  type McpGrantSnapshot,
  type McpReview,
  type McpTarget,
} from "@nervekit/contracts/mcp";
import type { PermissionRuleSet } from "@nervekit/contracts/permissions";
import type { TrustedResourceService } from "@nervekit/conversation-core";
import type { Skill } from "@nervekit/harness/resources";
import { builtInPermissionRuleSets } from "@nervekit/tools/policy";
import { version as nerveVersion } from "../../../app/version.js";
import { parseSuggestionMarkdown } from "../../../domains/prompt-suggestions/prompt-suggestion-document.js";
import type { PromptSuggestionStatus } from "@nervekit/contracts/prompt-suggestions";
import {
  mcpConfigPath,
  projectMcpConfigPath,
} from "../../../domains/mcp/mcp-config.js";
import { projectAgentDocumentValue } from "../../../infrastructure/configuration/agent-configuration/project-chains/scoped-migrations.js";
import { profileDocumentValue } from "../../../infrastructure/configuration/agent-configuration/project-chains/profile-migrations.js";
import { buildConsent } from "../../extensions/extension-catalog/consent-summary.js";
import { hashExtensionContent } from "../../extensions/extension-catalog/content-hash.js";
import { readInstalledExtensions } from "../../extensions/extension-catalog/read-installed.js";
import {
  parsePermissionFile,
  ruleSetDirectory,
  type PermissionFileIdentity,
} from "../../permissions/permission-files.js";
import {
  digest as skillFolderDigest,
  files as skillFolderFiles,
} from "../../resources/project-skill-trust.js";
import {
  agentPreferencesLines,
  profileLines,
  type AgentReviewLookups,
} from "./summarize-agent.js";
import { extensionLines } from "./summarize-extension.js";
import { mcpLines } from "./summarize-mcp.js";
import { overlayLines, ruleSetLines } from "./summarize-permissions.js";
import { skillLines } from "./summarize-skill.js";
import { suggestionLines } from "./summarize-suggestion.js";
import { toItems, type ReviewLine } from "./review-lines.js";

const KIND_LABELS = {
  "agent-preferences": "Agent settings",
  "agent-profile": "Agent profile",
  "rule-set": "Permission rule set",
  "permission-overlay": "Permission rules",
  "mcp-servers": "MCP server",
  skill: "Skill",
  "prompt-suggestion": "Prompt suggestion",
  extension: "Extension",
} as const;

/** What the review service needs of the host. Structural, so tests can stand in for each. */
export type ConfigurationReviewPorts = {
  home: string;
  trust: Pick<TrustedResourceService, "find" | "decide" | "trustState">;
  projectDirectory(projectId: string): string | undefined;
  /** The agent files' locations (`AgentConfigurationPaths`). */
  agentPaths: {
    agent(scope: AgentScope): string;
    profile(
      scope: AgentScope & { scope: "user" | "project" },
      name: string,
    ): string;
  };
  skills(projectDirectory: string | undefined): Promise<{
    user: { skills: readonly Skill[] };
    project: { skills: readonly Skill[] };
  }>;
  suggestions: {
    listStatuses(projectId?: string): Promise<PromptSuggestionStatus[]>;
  };
  extensions: {
    entries(projectDirectory?: string): Promise<ExtensionCatalogEntry[]>;
    grantConsent(
      ref: ExtensionRef,
      contentHash: string,
    ): Promise<"granted" | "changed" | "not_found">;
    reload(id?: string): Promise<void>;
  };
  mcp: {
    review(request: {
      target: McpTarget;
      name: string;
    }): Promise<McpReview | null>;
    checkDecision(input: {
      projectId: string | null;
      resourceKey: string;
      contentDigest: string;
    }): Promise<McpGrantSnapshot>;
  };
  /** A profile's rule set, by profile name. */
  profileRuleSetId: AgentReviewLookups["profileRuleSetId"];
  /** Makes a decision take effect: reloads the owner's state and tells the app (see the channel). */
  decided(
    target: ConfigurationReviewTarget,
    path: string | undefined,
  ): Promise<void>;
};

type ExtensionRef =
  | { source: "user"; id: string }
  | { source: "project"; id: string; projectDir: string };

/** What a review is made of before it is shaped for the wire. */
type Resolved = {
  name: string;
  lines: ReviewLine[];
  sources: TimedSource[];
  changedAt?: string;
  digest: string;
  /** Where the decision is stored. */
  trust: { kind: TrustedResourceKind; resourceKey: string };
  /** The lines the stored decision was made on, for `new`. */
  approved?: readonly string[];
  /** Set by owners that know better than the stored row (extensions, which load through their catalog). */
  state?: TrustState;
  changedSinceDecision?: boolean;
  /** Owners with their own decision path. */
  route?: "extension" | "mcp";
  extension?: { ref: ExtensionRef; contentHash: string };
};

const sha256 = (bytes: string | Buffer) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

export class ConfigurationReviewError extends Error {}

/** `~`-prefixed when under the user's folder, relative to `base` when given. */
function displayPath(path: string, base?: string): string {
  if (base) {
    const inside = relative(base, path);
    if (inside && !inside.startsWith("..") && !isAbsolute(inside))
      return inside;
  }
  const own = relative(homedir(), path);
  return own && !own.startsWith("..") && !isAbsolute(own) ? `~/${own}` : path;
}

type TimedSource = ConfigurationReviewSource & { mtimeMs?: number };

async function source(
  path: string,
  options: { base?: string; script?: boolean } = {},
): Promise<TimedSource> {
  const info = await stat(path).catch(() => undefined);
  return {
    path,
    label: displayPath(path, options.base),
    ...(info ? { bytes: info.size, mtimeMs: info.mtimeMs } : {}),
    ...(options.script ? { script: true } : {}),
  };
}

const latest = (entries: readonly { mtimeMs?: number }[]) => {
  const times = entries.flatMap((entry) =>
    entry.mtimeMs === undefined ? [] : [entry.mtimeMs],
  );
  return times.length > 0
    ? new Date(Math.max(...times)).toISOString()
    : undefined;
};

const missing = (target: ConfigurationReviewTarget) =>
  new ConfigurationReviewError(
    `There is no ${KIND_LABELS[target.kind as keyof typeof KIND_LABELS]?.toLowerCase() ?? target.kind} "${target.id}" in ${target.scope === "user" ? "your settings" : "this project"} to review.`,
  );

const unreadable = (what: string, reason: string) =>
  new ConfigurationReviewError(
    `${what} has problems and cannot be reviewed until they are fixed: ${reason}`,
  );

function snapshotOf(
  row: TrustedResource | null,
): readonly string[] | undefined {
  const parsed = configurationReviewSnapshotSchema.safeParse(row?.grants);
  return parsed.success ? parsed.data.items : undefined;
}

/**
 * The review of one configuration item and its decision: one summarizer per kind, one contract
 * (`configuration.review` / `configuration.decide`). Decisions are stored by `TrustedResourceService`
 * (extensions and MCP entries through their own consent paths), always for the digest the user saw.
 */
export class ConfigurationReviewService {
  constructor(private readonly ports: ConfigurationReviewPorts) {}

  async review(
    target: ConfigurationReviewTarget,
  ): Promise<ConfigurationReview> {
    const projectId = this.projectId(target);
    const resolved = await this.resolve(target, projectId);
    const row = this.row(resolved, projectId);
    const state =
      resolved.state ?? this.ports.trust.trustState(row, resolved.digest);
    const approved = resolved.approved ?? snapshotOf(row);
    return {
      target,
      name: resolved.name,
      kindLabel: KIND_LABELS[target.kind as keyof typeof KIND_LABELS],
      state,
      changedSinceDecision:
        resolved.changedSinceDecision ??
        (!!row && row.contentDigest !== resolved.digest),
      ...(resolved.changedAt ? { changedAt: resolved.changedAt } : {}),
      items: toItems(resolved.lines, approved),
      sources: resolved.sources.map((entry) => ({
        path: entry.path,
        label: entry.label,
        ...(entry.bytes === undefined ? {} : { bytes: entry.bytes }),
        ...(entry.script ? { script: true as const } : {}),
      })),
      digest: resolved.digest,
    };
  }

  async decide(decision: ConfigurationDecision): Promise<ConfigurationReview> {
    const { target } = decision;
    const projectId = this.projectId(target);
    const resolved = await this.resolve(target, projectId);
    if (resolved.digest !== decision.digest)
      throw new ConfigurationReviewError(
        `${resolved.name} changed since you reviewed it. Review it again.`,
      );
    const status = decision.trusted ? "trusted" : "rejected";
    if (resolved.route === "mcp") {
      const grants = await this.ports.mcp.checkDecision({
        projectId,
        resourceKey: target.id,
        contentDigest: resolved.digest,
      });
      this.ports.trust.decide({
        kind: "mcp_server",
        projectId,
        resourceKey: target.id,
        name: target.id,
        contentDigest: toTrustedDigest(resolved.digest),
        status,
        grants,
      });
    } else if (resolved.route === "extension" && resolved.extension) {
      const { ref, contentHash } = resolved.extension;
      if (decision.trusted) {
        const outcome = await this.ports.extensions.grantConsent(
          ref,
          contentHash,
        );
        if (outcome !== "granted")
          throw new ConfigurationReviewError(
            `${resolved.name} changed since you reviewed it. Review it again.`,
          );
      } else {
        this.ports.trust.decide({
          kind: "extension",
          projectId,
          resourceKey: resolved.trust.resourceKey,
          name: resolved.name,
          contentDigest: toTrustedDigest(contentHash),
          status: "rejected",
        });
        await this.ports.extensions.reload(ref.id);
      }
    } else {
      this.ports.trust.decide({
        kind: resolved.trust.kind,
        projectId,
        resourceKey: resolved.trust.resourceKey,
        name: resolved.name,
        contentDigest: toTrustedDigest(resolved.digest),
        status,
        grants: { items: resolved.lines.map((entry) => entry.text) },
      });
    }
    await this.ports.decided(
      target,
      resolved.route ? undefined : resolved.trust.resourceKey,
    );
    return await this.review(target);
  }

  private row(resolved: Resolved, projectId: string | null) {
    try {
      return this.ports.trust.find(
        resolved.trust.kind,
        projectId,
        resolved.trust.resourceKey,
      );
    } catch {
      // An unreadable row is untrusted, never the other way around.
      return null;
    }
  }

  private projectId(target: ConfigurationReviewTarget): string | null {
    if (target.scope === "user") return null;
    if (!target.projectId)
      throw new ConfigurationReviewError(
        "A project item needs the project it belongs to.",
      );
    return target.projectId;
  }

  private directory(projectId: string | null): string | undefined {
    if (!projectId) return undefined;
    const directory = this.ports.projectDirectory(projectId);
    if (!directory) throw new ConfigurationReviewError("Project not found");
    return directory;
  }

  private async resolve(
    target: ConfigurationReviewTarget,
    projectId: string | null,
  ): Promise<Resolved> {
    switch (target.kind) {
      case "agent-preferences":
        return this.agentPreferences(target, projectId);
      case "agent-profile":
        return this.profile(target, projectId);
      case "rule-set":
        return this.ruleSet(target, projectId);
      case "permission-overlay":
        return this.overlay(target, projectId);
      case "skill":
        return this.skill(target, projectId);
      case "prompt-suggestion":
        return this.suggestion(target, projectId);
      case "extension":
        return this.extension(target, projectId);
      case "mcp-servers":
        return this.mcpServer(target, projectId);
      default:
        throw new ConfigurationReviewError(
          `A ${target.kind} is not reviewed here; it is not something that needs your approval.`,
        );
    }
  }

  private async lookups(): Promise<AgentReviewLookups> {
    return {
      ruleSet: (id) => this.findRuleSet(id),
      profileRuleSetId: this.ports.profileRuleSetId,
    };
  }

  private async findRuleSet(
    id: string,
  ): Promise<PermissionRuleSet | undefined> {
    const builtin = builtInPermissionRuleSets.find((entry) => entry.id === id);
    if (builtin) return builtin;
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(id)) return undefined;
    const bytes = await readFile(
      join(ruleSetDirectory(this.ports.home), `${id}.json`),
      "utf8",
    ).catch(() => undefined);
    if (bytes === undefined) return undefined;
    const parsed = parsePermissionFile(
      { scope: "user", kind: "rule-set", document: `rule-set:${id}` },
      { kind: "bytes", bytes },
    );
    return parsed.ok ? parsed.ruleSet : undefined;
  }

  /** Reads a file the review is about; fails as a missing item. */
  private async read(
    target: ConfigurationReviewTarget,
    path: string,
  ): Promise<string> {
    try {
      return await readFile(path, "utf8");
    } catch {
      throw missing(target);
    }
  }

  private async agentPreferences(
    target: ConfigurationReviewTarget,
    projectId: string | null,
  ): Promise<Resolved> {
    const scope: AgentScope = projectId
      ? { scope: "project", projectId }
      : { scope: "user" };
    const path = this.ports.agentPaths.agent(scope);
    const text = await this.read(target, path);
    let lines: ReviewLine[];
    try {
      const value: unknown = JSON.parse(text);
      const preferences = projectId
        ? projectAgentDocumentValue(value)
        : agentPreferencesSchema.parse(value);
      lines = await agentPreferencesLines(
        preferences,
        await this.lookups(),
        projectId ?? undefined,
      );
    } catch (error) {
      throw unreadable("agent.json", reason(error));
    }
    const file = await source(path);
    return {
      name: "agent.json",
      lines,
      sources: [file],
      ...(latest([file]) ? { changedAt: latest([file])! } : {}),
      digest: sha256(text),
      trust: { kind: "capabilities", resourceKey: path },
    };
  }

  private async profile(
    target: ConfigurationReviewTarget,
    projectId: string | null,
  ): Promise<Resolved> {
    const scope = projectId
      ? ({ scope: "project", projectId } as const)
      : ({ scope: "user" } as const);
    let path: string;
    try {
      path = this.ports.agentPaths.profile(scope, target.id);
    } catch {
      throw missing(target);
    }
    const bytes = await readFile(path).catch(() => undefined);
    if (bytes === undefined) throw missing(target);
    let lines: ReviewLine[];
    let name: string;
    try {
      const value: unknown = JSON.parse(bytes.toString("utf8"));
      const definition = projectId
        ? profileDocumentValue(value)
        : profileDefinitionSchema.parse(value);
      if (definition.name !== target.id)
        throw new Error("Its name differs from its file name");
      lines = await profileLines(definition, scope.scope, await this.lookups());
      name = definition.label ?? definition.name;
    } catch (error) {
      throw unreadable(`The profile ${target.id}`, reason(error));
    }
    const file = await source(path);
    return {
      name,
      lines,
      sources: [file],
      ...(latest([file]) ? { changedAt: latest([file])! } : {}),
      digest: sha256(bytes),
      trust: { kind: "agent_profile", resourceKey: path },
    };
  }

  private async permissionFile(
    target: ConfigurationReviewTarget,
    path: string,
    identity: PermissionFileIdentity,
  ) {
    const bytes = await this.read(target, path);
    const parsed = parsePermissionFile(identity, { kind: "bytes", bytes });
    if (!parsed.ok)
      throw unreadable(
        basename(path),
        parsed.diagnostics.map((entry) => entry.message).join("; "),
      );
    const file = await source(path);
    return { bytes, parsed, file };
  }

  private async ruleSet(
    target: ConfigurationReviewTarget,
    projectId: string | null,
  ): Promise<Resolved> {
    if (projectId || !/^[a-z0-9][a-z0-9._-]*$/.test(target.id))
      throw missing(target);
    const path = join(ruleSetDirectory(this.ports.home), `${target.id}.json`);
    const { bytes, parsed, file } = await this.permissionFile(target, path, {
      scope: "user",
      kind: "rule-set",
      document: `rule-set:${target.id}`,
    });
    if (!parsed.ruleSet) throw missing(target);
    return {
      name: parsed.ruleSet.name,
      lines: ruleSetLines(parsed.ruleSet),
      sources: [file],
      ...(latest([file]) ? { changedAt: latest([file])! } : {}),
      digest: sha256(bytes),
      trust: { kind: "permission_rule_set", resourceKey: path },
    };
  }

  private async overlay(
    target: ConfigurationReviewTarget,
    projectId: string | null,
  ): Promise<Resolved> {
    const directory = this.directory(projectId);
    const path = directory
      ? join(directory, ".nerve", "config", "permissions.json")
      : join(this.ports.home, "config", "permissions.json");
    const { bytes, parsed, file } = await this.permissionFile(target, path, {
      scope: directory ? "project" : "user",
      kind: "permission-overlay",
      document: "permissions.json",
    });
    return {
      name: "permissions.json",
      lines: overlayLines(parsed.overlay ?? { schemaVersion: 2, overlays: [] }),
      sources: [file],
      ...(latest([file]) ? { changedAt: latest([file])! } : {}),
      digest: sha256(bytes),
      trust: { kind: "permissions", resourceKey: path },
    };
  }

  private async skill(
    target: ConfigurationReviewTarget,
    projectId: string | null,
  ): Promise<Resolved> {
    const groups = await this.ports.skills(this.directory(projectId));
    const skill = (projectId ? groups.project : groups.user).skills.find(
      (entry) => entry.name === target.id,
    );
    if (!skill) throw missing(target);
    const folder = dirname(skill.filePath);
    const listed = await skillFolderFiles(folder);
    const sources = await Promise.all(
      listed.map((file) =>
        source(join(folder, file.path), {
          base: folder,
          script: file.script,
        }),
      ),
    );
    return {
      name: skill.name,
      lines: skillLines({
        description: skill.description,
        scope: projectId ? "project" : "user",
        files: listed,
      }),
      sources,
      ...(latest(sources) ? { changedAt: latest(sources)! } : {}),
      digest: await skillFolderDigest(folder, listed),
      trust: { kind: "skill", resourceKey: folder },
    };
  }

  private async suggestion(
    target: ConfigurationReviewTarget,
    projectId: string | null,
  ): Promise<Resolved> {
    const statuses = await this.ports.suggestions.listStatuses(
      projectId ?? undefined,
    );
    const status = statuses.find(
      (entry) => entry.name === target.id && entry.sourceKind === target.scope,
    );
    if (!status) throw missing(target);
    const bytes = await this.read(target, status.path);
    const { definition, diagnostics } = parseSuggestionMarkdown(
      {
        kind: target.scope,
        dir: dirname(status.path),
        ...(projectId ? { projectId } : {}),
      },
      status.path,
      bytes,
    );
    if (!definition)
      throw unreadable(
        basename(status.path),
        diagnostics.map((entry) => entry.message).join("; "),
      );
    const file = await source(status.path);
    return {
      name: definition.label,
      lines: suggestionLines(definition, target.scope),
      sources: [file],
      ...(latest([file]) ? { changedAt: latest([file])! } : {}),
      digest: sha256(bytes),
      trust: { kind: "prompt_suggestion", resourceKey: status.path },
    };
  }

  private async extension(
    target: ConfigurationReviewTarget,
    projectId: string | null,
  ): Promise<Resolved> {
    const directory = this.directory(projectId);
    const entry = (await this.ports.extensions.entries(directory)).find(
      (candidate) =>
        candidate.id === target.id && candidate.source === target.scope,
    );
    if (!entry?.path) throw missing(target);
    if (entry.state === "invalid" || entry.state === "incompatible")
      throw unreadable(
        `The extension ${entry.id}`,
        entry.diagnostics.map((item) => item.message).join("; ") ||
          "it is not valid",
      );
    const folder = entry.path;
    const read = (
      await readInstalledExtensions(dirname(folder), nerveVersion)
    ).find((candidate) => candidate.folder === folder);
    if (!read?.manifest)
      throw unreadable(
        `The extension ${entry.id}`,
        "its manifest is not valid",
      );
    const contentHash = await hashExtensionContent(folder);
    const row = this.ports.trust.find("extension", projectId, folder);
    const changed = !!row && row.contentDigest !== toTrustedDigest(contentHash);
    const pending = entry.state === "pending_consent";
    const previous = pending
      ? extensionGrantSnapshotSchema.safeParse(
          row?.status === "trusted" ? row.grants : undefined,
        ).data
      : undefined;
    const consent = buildConsent({
      manifest: read.manifest,
      contentHash,
      ...(previous ? { previous } : {}),
    });
    // An update lists only what is new, so all of it is; a first consent has nothing to compare with.
    const lines = extensionLines(consent);
    const dist = await distFiles(folder);
    return {
      name: read.manifest.name ?? entry.id,
      lines,
      sources: dist,
      ...(latest(dist) ? { changedAt: latest(dist)! } : {}),
      digest: contentHash,
      trust: { kind: "extension", resourceKey: folder },
      route: "extension",
      state: pending ? (entry.trustState ?? "needs_review") : "trusted",
      changedSinceDecision: changed,
      approved: consent.update ? [] : undefined,
      extension: {
        ref:
          target.scope === "user"
            ? { source: "user", id: entry.id }
            : { source: "project", id: entry.id, projectDir: directory! },
        contentHash,
      },
    };
  }

  private async mcpServer(
    target: ConfigurationReviewTarget,
    projectId: string | null,
  ): Promise<Resolved> {
    const directory = this.directory(projectId);
    const review = await this.ports.mcp.review({
      target: projectId ? { scope: "project", projectId } : { scope: "user" },
      name: target.id,
    });
    // A project page also shows the user's servers; those are reviewed at user scope.
    if (!review || review.scope !== target.scope) throw missing(target);
    const row = this.ports.trust.find("mcp_server", projectId, target.id);
    const previous = row?.grants ? mcpGrantsOf(row.grants) : undefined;
    const file = await source(
      directory
        ? projectMcpConfigPath(directory)
        : mcpConfigPath(this.ports.home),
    );
    return {
      name: review.name,
      lines: mcpLines(review.grants),
      sources: [file],
      ...(latest([file]) ? { changedAt: latest([file])! } : {}),
      digest: review.digest,
      trust: { kind: "mcp_server", resourceKey: target.id },
      route: "mcp",
      state: review.status,
      approved: previous
        ? mcpLines(previous).map((entry) => entry.text)
        : undefined,
    };
  }
}

function mcpGrantsOf(grants: unknown) {
  const parsed = mcpGrantSnapshotSchema.safeParse(grants);
  return parsed.success ? parsed.data : undefined;
}

const reason = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const SCRIPT_EXTENSIONS = /\.(m?js|cjs)$/;

/** The files of an extension's `dist/`: what the user's consent covers. */
async function distFiles(folder: string) {
  const { readdir } = await import("node:fs/promises");
  const found: TimedSource[] = [];
  const dist = join(folder, "dist");
  const walk = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true }).catch(
      () => [],
    );
    for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (found.length >= 200) return;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile())
        found.push(
          await source(path, {
            base: folder,
            script: SCRIPT_EXTENSIONS.test(entry.name),
          }),
        );
    }
  };
  await walk(dist);
  return found;
}
