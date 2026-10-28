import { createHash } from "node:crypto";
import { completionRemoteFailure } from "./completion-source-failure.js";
import type {
  CompletionScope,
  CompletionItem,
} from "@nervekit/contracts/completions";
import {
  capabilityToolNameSchema,
  type CapabilityToolName,
} from "@nervekit/contracts/capabilities";
import { isSubagentTool, type ToolDescriptor } from "@nervekit/contracts/tools";
import {
  skillOverrideKind,
  type AvailableSkill,
} from "@nervekit/contracts/skills";
import type { GithubPr, GithubIssueSummary } from "@nervekit/contracts/git";
import type { LaunchRecord } from "@nervekit/contracts/launches";
import type { LaunchDefinitionCatalog } from "@nervekit/contracts/launch-definitions";
import type { ConversationSummary } from "@nervekit/contracts/core";
import {
  resolveAgentConfiguration,
  type LeadSettingsOverrides,
} from "@nervekit/contracts/agent-configuration";
import type { AgentConfigurationService } from "../../infrastructure/configuration/agent-configuration/agent-configuration-service.js";
import { discoverEntries } from "./file-completion-candidates.js";
import { completionDocumentId } from "./completion-document-identity.js";
import { FileCompletionDocument } from "./file-completion-document.js";
import type {
  CompletionDocument,
  CompletionProvider,
  CompletionProviderSnapshot,
  CompletionInvalidate,
  SearchDocument,
} from "./completion-provider.js";

export type CompletionRemoteSnapshot<T> = {
  items: readonly T[];
  refreshing: boolean;
  updatedAt?: string | null;
  failed?: boolean;
  failureCode?: string;
  stale?: boolean;
};
export function mergeCompletionRemoteSnapshots<T>(
  snapshots: readonly CompletionRemoteSnapshot<T>[],
  now = Date.now,
): CompletionRemoteSnapshot<T> {
  const current = now();
  const times = snapshots.map((snapshot) =>
    snapshot.updatedAt ? Date.parse(snapshot.updatedAt) : NaN,
  );
  const validTimes = times.filter(Number.isFinite);
  const failed = snapshots.some((snapshot) => snapshot.failed);
  const stale =
    failed ||
    snapshots.some(
      (snapshot, i) =>
        !Number.isFinite(times[i]) ||
        snapshot.stale === true ||
        (snapshot.stale === undefined && current - times[i] >= 60_000),
    );
  return {
    items: snapshots.flatMap((snapshot) => snapshot.items),
    refreshing: snapshots.some((snapshot) => snapshot.refreshing),
    failed,
    ...(snapshots.find((snapshot) => snapshot.failureCode)?.failureCode
      ? {
          failureCode: snapshots.find((snapshot) => snapshot.failureCode)!
            .failureCode,
        }
      : {}),
    stale,
    updatedAt: validTimes.length
      ? new Date(Math.min(...validTimes)).toISOString()
      : snapshots.length
        ? null
        : new Date(current).toISOString(),
  };
}
type CompletionLaunchRecord = Pick<
  LaunchRecord,
  "id" | "projectId" | "displayName" | "name" | "status" | "updatedAt"
>;
export type CompletionSourcePorts = {
  project(projectId: string): { id: string; directory: string };
  configuration: Pick<
    AgentConfigurationService,
    | "ensureLoaded"
    | "getEffective"
    | "captureDefaults"
    | "save"
    | "subscribeHealth"
  > & { profiles: Pick<AgentConfigurationService["profiles"], "list"> };
  isProjectAgentTrusted(
    projectId: string,
    path: string,
    digest: string,
  ): boolean;
  skills(scope: CompletionScope): Promise<readonly AvailableSkill[]>;
  tools: readonly Pick<ToolDescriptor, "name" | "description">[];
  prs(
    projectId: string,
  ): Promise<
    CompletionRemoteSnapshot<
      Pick<
        GithubPr,
        | "number"
        | "title"
        | "url"
        | "state"
        | "headRefName"
        | "updatedAt"
        | "author"
      > & { repository?: string; isDraft?: boolean }
    >
  >;
  issues(
    projectId: string,
  ): Promise<
    CompletionRemoteSnapshot<GithubIssueSummary & { repository?: string }>
  >;
  remoteChanged?(
    source: "pull_requests" | "issues",
    listener: CompletionInvalidate,
  ): () => void;
  launches():
    | readonly CompletionLaunchRecord[]
    | Promise<readonly CompletionLaunchRecord[]>;
  definitions(projectId: string): Promise<LaunchDefinitionCatalog>;
  children(
    scope: CompletionScope,
  ): readonly Pick<
    ConversationSummary,
    | "id"
    | "title"
    | "projectId"
    | "parentConversationId"
    | "status"
    | "updatedAt"
  >[];
  discover?: typeof discoverEntries;
};
const fields = (
  values: [
    SearchDocument["fields"][number]["key"],
    string | null | undefined,
  ][],
): SearchDocument["fields"] =>
  values.map(([key, text]) => ({ key, text: text ?? "" }));
function document(
  scope: CompletionScope,
  kind: CompletionItem["kind"],
  identity: string,
  item: Omit<CompletionItem, "kind">,
  text: SearchDocument["fields"],
  versionData: unknown,
  extra: Partial<CompletionDocument> = {},
): CompletionDocument {
  const id = completionDocumentId(kind, identity);
  const version = createHash("sha256")
    .update(JSON.stringify([item, text, versionData]))
    .digest("hex");
  return {
    id,
    kind,
    fields: text,
    projectId: scope.projectId,
    item: { ...item, kind },
    version,
    displayField: { index: 0, offset: 0 },
    ...extra,
  };
}
function capabilityName(name: string): CapabilityToolName | undefined {
  const grouped = isSubagentTool(name)
    ? "subagents"
    : name.startsWith("jira_")
      ? "jira"
      : name.startsWith("confluence_")
        ? "confluence"
        : name;
  const parsed = capabilityToolNameSchema.safeParse(grouped);
  return parsed.success ? parsed.data : undefined;
}
const pointerSegment = (value: string) =>
  value.replaceAll("~", "~0").replaceAll("/", "~1");
const editScope = (scope: CompletionScope) =>
  scope.conversationId
    ? { scope: "conversation" as const, conversationId: scope.conversationId }
    : { scope: "project" as const, projectId: scope.projectId };

async function completionSettings(
  ports: CompletionSourcePorts,
  scope: CompletionScope,
) {
  const target = editScope(scope);
  const health = await ports.configuration.ensureLoaded(target);
  if (health.status === "unavailable")
    throw new Error("Agent configuration unavailable");
  const view = scope.conversationId
    ? await ports.configuration.getEffective(scope.conversationId)
    : undefined;
  if (view?.status === "unavailable")
    throw new Error("Agent configuration unavailable");
  const resolution =
    view?.resolution ??
    resolveAgentConfiguration({
      ...(await ports.configuration.captureDefaults(scope.projectId)).options,
      role: "lead",
    });
  const writable =
    view?.role !== "child" &&
    (target.scope === "conversation" ||
      health.status === "missing-optional" ||
      ports.isProjectAgentTrusted(
        scope.projectId,
        health.value.path,
        health.value.digest,
      ));
  return {
    settings: resolution.settings,
    missing: resolution.diagnostics
      .filter((issue) => issue.code === "missing-reference")
      .map((issue) => issue.pointer),
    writable,
    canChange: (pointer: string) =>
      writable &&
      !Object.entries(resolution.provenance).some(
        ([path, value]) =>
          value.source === "requirement" &&
          (path === pointer ||
            pointer.startsWith(`${path}/`) ||
            path.startsWith(`${pointer}/`)),
      ),
    version: health.value.digest,
    save: (changes: LeadSettingsOverrides) => {
      if (!writable)
        throw new Error("Preference editing is unavailable for this scope");
      return ports.configuration.save(target, {
        expectedRevision: health.value.document.revision,
        expectedDigest: health.value.digest,
        changes,
        resets: [],
      });
    },
  };
}

function remoteSnapshot<T>(
  documents: CompletionDocument[],
  snapshot: CompletionRemoteSnapshot<T>,
): CompletionProviderSnapshot {
  const parsed = snapshot.updatedAt ? Date.parse(snapshot.updatedAt) : NaN;
  const updatedAt = Number.isFinite(parsed) ? parsed : undefined;
  const cached = updatedAt !== undefined || documents.length > 0;
  const stale =
    snapshot.failed ||
    (snapshot.stale ??
      (updatedAt === undefined || Date.now() - updatedAt >= 60_000));
  return {
    documents,
    status: snapshot.refreshing
      ? cached
        ? "stale"
        : "loading"
      : cached
        ? stale
          ? "stale"
          : "fresh"
        : "unavailable",
    refreshing: snapshot.refreshing,
    ...(snapshot.failureCode ||
    snapshot.failed ||
    (!cached && !snapshot.refreshing)
      ? completionRemoteFailure(snapshot.failureCode, cached)
      : {}),
    ...(updatedAt === undefined ? {} : { updatedAt }),
  };
}

export function createCompletionProviders(
  ports: CompletionSourcePorts,
): CompletionProvider[] {
  const capabilitiesChanged: CompletionProvider["subscribe"] = (listener) =>
    ports.configuration.subscribeHealth((change) =>
      listener(change.scope === "user" ? {} : change),
    );
  return [
    {
      id: "files",
      ttlMs: 120_000,
      async load(scope) {
        const project = ports.project(scope.projectId);
        if (project.id !== scope.projectId)
          throw new Error("Wrong project completion root");
        return (
          await (ports.discover ?? discoverEntries)(project.directory)
        ).map(
          (candidate) =>
            new FileCompletionDocument(
              scope.projectId,
              candidate.relativePath,
              candidate.kind,
            ),
        );
      },
    },
    {
      id: "pull_requests",
      remote: true,
      ttlMs: 30_000,
      subscribe: (listener) =>
        ports.remoteChanged?.("pull_requests", listener) ?? (() => {}),
      async load(scope) {
        const snapshot = await ports.prs(scope.projectId);
        const documents = [
          ...new Map(snapshot.items.map((pr) => [pr.url, pr])).values(),
        ].map((pr) =>
          document(
            scope,
            "pull_request",
            pr.url,
            {
              label: pr.url,
              displayLabel: `#${pr.number} ${pr.title}`,
              status: pr.isDraft ? "draft" : pr.state.toLowerCase(),
              detail: `${pr.headRefName}${pr.author ? ` · ${pr.author}` : ""}${pr.repository ? ` · ${pr.repository}` : ""}`,
              info: pr.url,
            },
            fields([
              ["title", pr.title],
              ["identifier", String(pr.number)],
              ["name", pr.headRefName],
              ["description", pr.author],
              ["name", pr.repository],
            ]),
            pr.updatedAt,
            {
              stateBoost: pr.state.toLowerCase() === "open" ? 40 : 0,
              displayFields: [
                { index: 0, offset: String(pr.number).length + 2 },
                { index: 1, offset: 1 },
              ],
              detailFields: [
                { index: 2, offset: 0 },
                {
                  index: 3,
                  offset: `${pr.headRefName} · `.length,
                },
                {
                  index: 4,
                  offset:
                    `${pr.headRefName}${pr.author ? ` · ${pr.author}` : ""} · `
                      .length,
                },
              ],
            },
          ),
        );
        return remoteSnapshot(documents, snapshot);
      },
    },
    {
      id: "issues",
      remote: true,
      ttlMs: 30_000,
      subscribe: (listener) =>
        ports.remoteChanged?.("issues", listener) ?? (() => {}),
      async load(scope) {
        const snapshot = await ports.issues(scope.projectId);
        const documents = [
          ...new Map(
            snapshot.items.map((issue) => [issue.url, issue]),
          ).values(),
        ].map((issue) =>
          document(
            scope,
            "issue",
            issue.url,
            {
              label: issue.url,
              displayLabel: `#${issue.number} ${issue.title}`,
              status: issue.state.toLowerCase(),
              detail: [issue.author, issue.repository]
                .filter(Boolean)
                .join(" · "),
              info: issue.url,
            },
            fields([
              ["title", issue.title],
              ["identifier", String(issue.number)],
              ["description", issue.author],
              ["name", issue.repository],
            ]),
            issue.updatedAt,
            {
              stateBoost: issue.state.toLowerCase() === "open" ? 40 : 0,
              displayFields: [
                { index: 0, offset: String(issue.number).length + 2 },
                { index: 1, offset: 1 },
              ],
              detailFields: [
                { index: 2, offset: 0 },
                {
                  index: 3,
                  offset: issue.author ? `${issue.author} · `.length : 0,
                },
              ],
            },
          ),
        );
        return remoteSnapshot(documents, snapshot);
      },
    },
    {
      id: "launches",
      ttlMs: 2_000,
      async load(scope) {
        const launches = await ports.launches();
        return launches
          .filter(
            (launch) =>
              launch.projectId === scope.projectId &&
              ["starting", "running", "ready", "stopping"].includes(
                launch.status,
              ),
          )
          .map((launch) => {
            const name = launch.displayName ?? launch.name ?? launch.id;
            // Launch records are references, not arbitrary runnable command suggestions.
            return document(
              scope,
              "launch",
              launch.id,
              {
                label: launch.id,
                displayLabel: name,
                status: launch.status.toLowerCase(),
                detail: launch.id,
              },
              fields([
                ["name", name],
                ["identifier", launch.id],
              ]),
              launch.updatedAt,
              {
                stateBoost: 80,
                detailFields: [{ index: 1, offset: 0 }],
              },
            );
          });
      },
    },
    {
      id: "launch_definitions",
      ttlMs: 30_000,
      async load(scope) {
        const catalog = await ports.definitions(scope.projectId);
        if (catalog.projectId !== scope.projectId)
          throw new Error("Wrong project launch catalog");
        return catalog.definitions
          .filter(
            (definition) => definition.scope.projectId === scope.projectId,
          )
          .map((definition) => {
            const name = definition.label ?? definition.command;
            return document(
              scope,
              "launch_definition",
              definition.id,
              {
                label: `@launch:${definition.id}`,
                displayLabel: name,
                detail: definition.command,
                info: definition.command,
              },
              fields([
                ["name", name],
                ["identifier", definition.id],
                ["description", definition.command],
              ]),
              catalog.revision,
              {
                detailFields: [{ index: 2, offset: 0 }],
              },
            );
          });
      },
    },
    {
      id: "skills",
      scope: "conversation",
      accessSensitive: true,
      ttlMs: 30_000,
      subscribe: capabilitiesChanged,
      async load(scope) {
        const [catalog, config] = await Promise.all([
          ports.skills(scope),
          completionSettings(ports, scope),
        ]);
        // File copies share one owning toggle; builtin buckets remain distinct.
        const byIdentity = new Map<string, AvailableSkill>();
        for (const skill of catalog) {
          const identity = `${skillOverrideKind(skill.source)}:${skill.name}`;
          if (!byIdentity.has(identity)) byIdentity.set(identity, skill);
        }
        const priority = { file: 0, nerve: 1, agentBrowser: 2 };
        const enabledSkill = (skill: AvailableSkill) => {
          const bucket = skillOverrideKind(skill.source);
          return (
            config.settings.skills?.[bucket]?.[skill.name] ??
            config.settings.skills?.defaults?.[bucket] ??
            bucket === "file"
          );
        };
        const skills = [...byIdentity.values()];
        const enabledPriority = new Map<string, number>();
        for (const skill of skills)
          if (enabledSkill(skill))
            enabledPriority.set(
              skill.name,
              Math.min(
                enabledPriority.get(skill.name) ?? Infinity,
                priority[skillOverrideKind(skill.source)],
              ),
            );
        return skills.map((skill) => {
          const bucket = skillOverrideKind(skill.source);
          const writeAllowed = config.canChange(
            `/skills/${bucket}/${pointerSegment(skill.name)}`,
          );
          const enabled = enabledSkill(skill);
          const shadowed =
            (enabledPriority.get(skill.name) ?? Infinity) < priority[bucket];
          return document(
            scope,
            "skill",
            `${bucket}:${skill.name}`,
            {
              label: `@skill:${skill.name}`,
              displayLabel: skill.name,
              detail: skill.description,
              info: skill.source,
              enabled,
              available: !shadowed && (enabled || writeAllowed),
              canDisable: writeAllowed,
              ...(shadowed
                ? {
                    unavailableReason:
                      "An enabled same-name skill takes precedence; change skill settings to select this source",
                  }
                : !enabled && !writeAllowed
                  ? {
                      unavailableReason:
                        "Review agent settings, requirements and project trust before enabling",
                    }
                  : {}),
            },
            fields([
              ["name", skill.name],
              ["description", skill.description],
            ]),
            [config.version, config.settings],
            {
              detailFields: [{ index: 1, offset: 0 }],
              setEnabled: writeAllowed
                ? async (value) => {
                    await config.save({
                      skills: { [bucket]: { [skill.name]: value } },
                    });
                  }
                : undefined,
            },
          );
        });
      },
    },
    {
      id: "tools",
      scope: "conversation",
      accessSensitive: true,
      ttlMs: 30_000,
      subscribe: capabilitiesChanged,
      async load(scope) {
        const config = await completionSettings(ports, scope);
        return ports.tools.flatMap((tool) => {
          const name = capabilityName(tool.name);
          const writeAllowed =
            !!name && config.canChange(`/tools/${name}/enabled`);
          const entry = name ? config.settings.tools?.[name] : undefined;
          const enabled =
            !name ||
            name === "bash" ||
            !!(entry && "enabled" in entry && entry.enabled);
          const missing =
            name &&
            config.missing.some((pointer) =>
              pointer.startsWith(`/tools/${name}/`),
            );
          const available = !missing && (enabled || writeAllowed);
          return [
            document(
              scope,
              "tool",
              tool.name,
              {
                label: `@tool:${tool.name}`,
                displayLabel: tool.name,
                detail: tool.description,
                enabled,
                available,
                canDisable: !!name && name !== "bash" && writeAllowed,
                ...(!available
                  ? {
                      unavailableReason: !missing
                        ? "Review agent settings, requirements and project trust before enabling"
                        : "Choose an integration account in agent tool settings",
                    }
                  : {}),
              },
              fields([
                ["name", tool.name],
                ["description", tool.description],
              ]),
              [config.version, config.settings],
              {
                detailFields: [{ index: 1, offset: 0 }],
                ...(name && name !== "bash" && writeAllowed
                  ? {
                      setEnabled: async (value: boolean) => {
                        await config.save({
                          tools: { [name]: { enabled: value } },
                        });
                      },
                    }
                  : {}),
              },
            ),
          ];
        });
      },
    },
    {
      id: "profiles",
      scope: "conversation",
      accessSensitive: true,
      ttlMs: 30_000,
      subscribe: capabilitiesChanged,
      async load(scope) {
        const [config, catalog] = await Promise.all([
          completionSettings(ports, scope),
          ports.configuration.profiles.list(scope.projectId, "child"),
        ]);
        return Object.entries(catalog.profiles).map(([name, profile]) => {
          const definition =
            profile.status === "available" ? profile.definition : undefined;
          const selection = config.settings.subagents?.[name];
          const enabled = !!selection && selection.enabled !== false;
          const blocked = !definition;
          const writeAllowed = config.canChange(
            `/subagents/${pointerSegment(name)}/enabled`,
          );
          return document(
            scope,
            "agent_profile",
            name,
            {
              label: `@agent:${name}`,
              displayLabel: definition?.label ?? name,
              detail: definition?.whenToUse,
              enabled,
              available: !blocked && (enabled || writeAllowed),
              canDisable: !blocked && writeAllowed,
              ...(blocked
                ? {
                    unavailableReason:
                      "Review profile configuration and trust in agent settings.",
                  }
                : {}),
            },
            fields([
              ["name", definition?.label ?? name],
              ["identifier", name],
              ["description", definition?.whenToUse],
            ]),
            [config.version, profile],
            {
              detailFields: [{ index: 2, offset: 0 }],
              ...(!blocked && writeAllowed
                ? {
                    setEnabled: async (enabled: boolean) => {
                      await config.save({ subagents: { [name]: { enabled } } });
                    },
                  }
                : {}),
            },
          );
        });
      },
    },
    {
      id: "subagents",
      scope: "conversation",
      ttlMs: 1_000,
      async load(scope) {
        if (!scope.conversationId) return [];
        return ports
          .children(scope)
          .filter(
            (child) =>
              child.projectId === scope.projectId &&
              child.parentConversationId === scope.conversationId &&
              ["running", "queued", "waiting", "stopping"].includes(
                child.status,
              ),
          )
          .map((child) =>
            document(
              scope,
              "subagent",
              child.id,
              {
                label: `@agent:${child.id}`,
                displayLabel: child.title,
                status: child.status.toLowerCase(),
                detail: child.id,
              },
              fields([
                ["name", child.title],
                ["identifier", child.id],
              ]),
              child.updatedAt,
              {
                conversationId: scope.conversationId,
                stateBoost: 80,
                detailFields: [
                  {
                    index: 1,
                    offset: 0,
                  },
                ],
              },
            ),
          );
      },
    },
  ];
}
