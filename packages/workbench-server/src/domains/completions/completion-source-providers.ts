import { createHash } from "node:crypto";
import type {
  CompletionScope,
  CompletionItem,
} from "@nervekit/contracts/completions";
import {
  capabilityToolNameSchema,
  isProfiledCapabilityTool,
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
import type { CapabilityService } from "../../core-host/capability.service.js";
import type { SubagentProfileService } from "../subagents/subagent-profile.service.js";
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
  capabilities: Pick<
    CapabilityService,
    "configuration" | "update" | "subscribe"
  >;
  profiles: Pick<
    SubagentProfileService,
    "configuration" | "update" | "onChanged"
  >;
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
      > & { repository?: string }
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
const editScope = (scope: CompletionScope) =>
  scope.conversationId ? ("conversation" as const) : ("project" as const);

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
    ...(updatedAt === undefined ? {} : { updatedAt }),
  };
}

export function createCompletionProviders(
  ports: CompletionSourcePorts,
): CompletionProvider[] {
  const capabilitiesChanged: CompletionProvider["subscribe"] = (listener) =>
    ports.capabilities.subscribe(listener);
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
              detail: `${pr.state} · ${pr.headRefName}${pr.author ? ` · ${pr.author}` : ""}${pr.repository ? ` · ${pr.repository}` : ""}`,
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
                { index: 2, offset: `${pr.state} · `.length },
                {
                  index: 3,
                  offset: `${pr.state} · ${pr.headRefName} · `.length,
                },
                {
                  index: 4,
                  offset:
                    `${pr.state} · ${pr.headRefName}${pr.author ? ` · ${pr.author}` : ""} · `
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
              detail: `${issue.state} · issue${issue.author ? ` · ${issue.author}` : ""}${issue.repository ? ` · ${issue.repository}` : ""}`,
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
                { index: 2, offset: `${issue.state} · issue · `.length },
                {
                  index: 3,
                  offset:
                    `${issue.state} · issue${issue.author ? ` · ${issue.author}` : ""} · `
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
                detail: `${launch.status} · ${launch.id}`,
              },
              fields([
                ["name", name],
                ["identifier", launch.id],
              ]),
              launch.updatedAt,
              {
                stateBoost: 80,
                detailFields: [
                  { index: 1, offset: `${launch.status} · `.length },
                ],
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
                detail: `launch definition · ${definition.command}`,
                info: definition.command,
              },
              fields([
                ["name", name],
                ["identifier", definition.id],
                ["description", definition.command],
              ]),
              catalog.revision,
              {
                detailFields: [
                  { index: 2, offset: "launch definition · ".length },
                ],
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
          ports.capabilities.configuration(
            scope.projectId,
            scope.conversationId,
          ),
        ]);
        const digest =
          editScope(scope) === "conversation"
            ? config.conversationDigest
            : config.projectDigest;
        const writeAllowed =
          !!scope.conversationId ||
          config.trust.status === "trusted" ||
          config.trust.status === "missing";
        // File copies share one owning toggle; builtin buckets remain distinct.
        const byIdentity = new Map<string, AvailableSkill>();
        for (const skill of catalog) {
          const identity = `${skillOverrideKind(skill.source)}:${skill.name}`;
          if (!byIdentity.has(identity)) byIdentity.set(identity, skill);
        }
        const priority = { file: 0, nerve: 1, agentBrowser: 2 };
        const enabledSkill = (skill: AvailableSkill) => {
          const bucket = skillOverrideKind(skill.source);
          return bucket === "file"
            ? !config.effective.disabledFileSkills.includes(skill.name)
            : bucket === "nerve"
              ? config.effective.enabledNerveSkills.includes(skill.name)
              : config.effective.enabledAgentBrowserSkills.includes(skill.name);
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
              detail: `${skill.source} skill · ${skill.description}`,
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
                        "Review project capability trust in settings before enabling",
                    }
                  : {}),
            },
            fields([
              ["name", skill.name],
              ["description", skill.description],
            ]),
            [digest, config.effective],
            {
              detailFields: [
                { index: 1, offset: `${skill.source} skill · `.length },
              ],
              setEnabled: writeAllowed
                ? async (value) => {
                    await ports.capabilities.update({
                      projectId: scope.projectId,
                      conversationId: scope.conversationId,
                      layer: editScope(scope),
                      expectedDigest: digest,
                      patch: { skills: { [bucket]: { [skill.name]: value } } },
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
        const config = await ports.capabilities.configuration(
          scope.projectId,
          scope.conversationId,
        );
        const digest =
          editScope(scope) === "conversation"
            ? config.conversationDigest
            : config.projectDigest;
        const writeAllowed =
          !!scope.conversationId ||
          config.trust.status === "trusted" ||
          config.trust.status === "missing";
        return ports.tools.flatMap((tool) => {
          const name = capabilityName(tool.name);
          // Missing installation/provider configuration is not an enable toggle.
          if (name && !config.availableTools.includes(name)) return [];
          const enabled =
            !name || !config.effective.disabledTools.includes(name);
          let profileId =
            name && isProfiledCapabilityTool(name)
              ? config.effective.toolProfiles[name]
              : undefined;
          const choices =
            name && isProfiledCapabilityTool(name)
              ? config.toolProfileOptions[name]
              : [];
          const requiresProfile = name === "jira" || name === "confluence";
          if (
            requiresProfile &&
            !choices.some((profile) => profile.id === profileId)
          )
            profileId = choices.length === 1 ? choices[0].id : undefined;
          const profileAvailable = !requiresProfile || !!profileId;
          const available = profileAvailable && (enabled || writeAllowed);
          return [
            document(
              scope,
              "tool",
              tool.name,
              {
                label: `@tool:${tool.name}`,
                displayLabel: tool.name,
                detail: `tool · ${tool.description}`,
                enabled,
                available,
                canDisable: !!name && writeAllowed,
                ...(!available
                  ? {
                      unavailableReason: profileAvailable
                        ? "Review project capability trust in settings before enabling"
                        : "Choose an integration profile in capability settings",
                    }
                  : {}),
              },
              fields([
                ["name", tool.name],
                ["description", tool.description],
              ]),
              [digest, config.effective, config.toolProfileOptions],
              {
                detailFields: [{ index: 1, offset: "tool · ".length }],
                ...(name && writeAllowed
                  ? {
                      setEnabled: async (value: boolean) => {
                        await ports.capabilities.update({
                          projectId: scope.projectId,
                          conversationId: scope.conversationId,
                          layer: editScope(scope),
                          expectedDigest: digest,
                          patch: {
                            tools: {
                              [name]: {
                                enabled: value,
                                ...(value && profileId ? { profileId } : {}),
                              },
                            },
                          },
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
      subscribe: (listener) => ports.profiles.onChanged(listener),
      async load(scope) {
        const config = await ports.profiles.configuration({
          scope: editScope(scope),
          ...scope,
        });
        return config.profiles.map((profile) => {
          const effective = profile.effective;
          const blocked =
            profile.trust !== "trusted" ||
            !effective ||
            !!effective.error ||
            profile.diagnostics.some(
              (diagnostic) => diagnostic.severity === "blocking",
            );
          return document(
            scope,
            "subagent_profile",
            profile.name,
            {
              label: `@agent:${profile.name}`,
              displayLabel: effective?.label ?? profile.name,
              detail: `subagent profile · ${profile.name} · ${effective?.description ?? "Unavailable configuration"}`,
              enabled: effective?.enabled ?? false,
              available: !blocked,
              canDisable: !blocked,
              ...(blocked
                ? {
                    unavailableReason:
                      profile.diagnostics
                        .filter(
                          (diagnostic) => diagnostic.severity === "blocking",
                        )
                        .map((diagnostic) => diagnostic.message)
                        .join("; ") || "Profile is invalid or untrusted",
                  }
                : {}),
            },
            fields([
              ["name", effective?.label ?? profile.name],
              ["identifier", profile.name],
              ["description", effective?.description],
            ]),
            [config.digest, profile],
            {
              detailFields: [
                { index: 1, offset: "subagent profile · ".length },
                {
                  index: 2,
                  offset: `subagent profile · ${profile.name} · `.length,
                },
              ],
              ...(!blocked
                ? {
                    setEnabled: async (enabled: boolean) => {
                      await ports.profiles.update({
                        scope: editScope(scope),
                        ...scope,
                        name: profile.name,
                        expectedDigest: config.digest,
                        patch: { enabled },
                      });
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
                detail: `running subagent · ${child.status} · ${child.id}`,
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
                    offset: `running subagent · ${child.status} · `.length,
                  },
                ],
              },
            ),
          );
      },
    },
  ];
}
