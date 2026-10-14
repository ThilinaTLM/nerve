import { createHash } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  applyCapabilityPatch,
  capabilityOverridesDocumentSchema,
  capabilityToolNameSchema,
  emptyCapabilityOverrides,
  normalizeCapabilityOverrides,
  resolveCapabilitySelection,
  type CapabilityConfiguration,
  type CapabilityOrigin,
  type CapabilityOverridesDocument,
  type CapabilityPatch,
} from "@nervekit/contracts/capabilities";
import type { ConversationCore } from "@nervekit/conversation-core";
import {
  atomicWriteJson,
  type InitializedStorage,
} from "../infrastructure/storage-bootstrap/index.js";
import { resolveProjectSettings } from "../infrastructure/configuration/index.js";
import { listAvailableSkills } from "./resource-loader.js";
import type { Skill } from "@nervekit/harness/resources";
import type { SubagentProfile } from "@nervekit/contracts/subagents";
import {
  userCapabilitySelection,
  settingsWithCapabilityToolSettings,
} from "./user-capability-selection.js";

const sameDocument = (document: CapabilityOverridesDocument) =>
  JSON.stringify(document) === JSON.stringify(emptyCapabilityOverrides());

const digest = (content: string) =>
  `sha256:${createHash("sha256").update(content).digest("hex")}`;

/** File-owned overrides; the portable core owns only project content trust. */
export class CapabilityService {
  private writing: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<
    (change: { projectId: string; conversationId?: string }) => void
  >();
  constructor(
    private readonly storage: InitializedStorage,
    private readonly core: ConversationCore,
  ) {}

  private write<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.writing.then(operation);
    this.writing = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  subscribe(
    listener: (change: { projectId: string; conversationId?: string }) => void,
  ) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private project(projectId: string) {
    const project = this.core.projects.get(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);
    return project;
  }
  private projectPath(projectId: string) {
    return join(
      this.project(projectId).directory,
      ".nerve",
      "config",
      "capabilities.json",
    );
  }
  private conversationPath(projectId: string, conversationId: string) {
    if (
      this.core.getSnapshot(conversationId).conversation.projectId !== projectId
    )
      throw new Error("Conversation does not belong to project");
    return join(
      this.storage.paths.dataPath,
      "conversations",
      conversationId,
      "config",
      "capabilities.json",
    );
  }
  private async read(path: string) {
    let content: string;
    try {
      content = await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return { document: emptyCapabilityOverrides(), digest: "missing" };
      throw error;
    }
    return {
      document: capabilityOverridesDocumentSchema.parse(JSON.parse(content)),
      digest: digest(content),
    };
  }

  async configuration(
    projectId: string,
    conversationId?: string,
  ): Promise<CapabilityConfiguration> {
    const settings = this.storage.settings;
    const user = userCapabilitySelection(settings);
    const path = this.projectPath(projectId);
    let project;
    let trust: CapabilityConfiguration["trust"];
    try {
      project = await this.read(path);
      const record = this.core.trust
        .list(projectId, "project_capabilities")
        .find((row) => row.path === path);
      trust =
        project.digest === "missing"
          ? { status: "missing" }
          : this.core.trust.isTrusted(
                "project_capabilities",
                projectId,
                path,
                project.digest,
              )
            ? {
                status: "trusted",
                digest: project.digest,
                trustedDigest: project.digest,
                trustedAt: record!.updatedAt,
              }
            : {
                status: "untrusted",
                digest: project.digest,
                reason:
                  "Trust the exact project capability file before applying it.",
              };
    } catch (error) {
      project = { document: emptyCapabilityOverrides(), digest: "invalid" };
      trust = {
        status: "invalid",
        reason: error instanceof Error ? error.message : String(error),
      };
    }
    const trusted = trust.status === "trusted" ? project.document : undefined;
    const conversation = conversationId
      ? await this.read(this.conversationPath(projectId, conversationId))
      : undefined;
    const inherited = conversationId
      ? resolveCapabilitySelection({ user, project: trusted })
      : user;
    const atlassian = settings.providers.atlassianProfiles.map((profile) => ({
      id: profile.id,
      name: profile.name,
      ...(profile.siteUrl ? { detail: profile.siteUrl } : {}),
    }));
    return {
      project: project.document,
      ...(conversation
        ? {
            conversation: conversation.document,
            conversationDigest: conversation.digest,
          }
        : {}),
      projectDigest: project.digest,
      trust,
      inherited,
      effective: resolveCapabilitySelection({
        user,
        project: trusted,
        conversation: conversation?.document,
      }),
      availableTools: capabilityToolNameSchema.options.filter(
        (name) =>
          (name !== "jira" && name !== "confluence") || atlassian.length > 0,
      ),
      toolProfileOptions: {
        jira: atlassian,
        confluence: atlassian,
        web_search: settings.providers.tavilyProfiles.map(({ id, name }) => ({
          id,
          name,
        })),
      },
    };
  }

  async settings(projectId: string, conversationId: string) {
    const { effective } = await this.configuration(projectId, conversationId);
    const settings = settingsWithCapabilityToolSettings(
      await resolveProjectSettings(
        this.storage,
        this.project(projectId).directory,
      ),
      effective.toolSettings,
    );
    return {
      ...settings,
      tools: {
        ...settings.tools,
        jira: {
          enabled: !effective.disabledTools.includes("jira"),
          profileId: effective.toolProfiles.jira,
        },
        confluence: {
          enabled: !effective.disabledTools.includes("confluence"),
          profileId: effective.toolProfiles.confluence,
        },
        web: {
          ...settings.tools.web,
          tavilyProfileId: effective.toolProfiles.web_search,
        },
      },
    };
  }

  async update(input: {
    projectId: string;
    conversationId?: string;
    layer: CapabilityOrigin;
    patch?: CapabilityPatch;
    replace?: CapabilityOverridesDocument;
    expectedDigest?: string;
  }) {
    return this.write(async () => {
      if ((input.patch === undefined) === (input.replace === undefined))
        throw new Error("Provide exactly one of patch or replace");
      if (input.layer === "conversation" && !input.conversationId)
        throw new Error("Conversation ID required");
      const path =
        input.layer === "project"
          ? this.projectPath(input.projectId)
          : this.conversationPath(input.projectId, input.conversationId!);
      const current = await this.read(path);
      if (
        input.expectedDigest !== undefined &&
        input.expectedDigest !== current.digest
      )
        throw new Error("Capability file changed; refresh before saving");
      const parent = (
        await this.configuration(
          input.projectId,
          input.layer === "conversation" ? input.conversationId : undefined,
        )
      ).inherited;
      const next = input.replace
        ? normalizeCapabilityOverrides(input.replace, parent)
        : applyCapabilityPatch(current.document, input.patch!, parent);
      await atomicWriteJson(path, next);
      if (input.layer === "project")
        await this.trustProject(
          input.projectId,
          (await this.read(path)).digest,
          false,
        );
      this.changed(
        input.projectId,
        input.layer === "conversation" ? input.conversationId : undefined,
      );
      return this.configuration(input.projectId, input.conversationId);
    });
  }

  async reset(input: {
    projectId: string;
    conversationId?: string;
    layer: CapabilityOrigin;
  }) {
    return this.write(async () => {
      if (input.layer === "conversation" && !input.conversationId)
        throw new Error("Conversation ID required");
      const path =
        input.layer === "project"
          ? this.projectPath(input.projectId)
          : this.conversationPath(input.projectId, input.conversationId!);
      await rm(path, { force: true });
      this.changed(
        input.projectId,
        input.layer === "conversation" ? input.conversationId : undefined,
      );
      return this.configuration(input.projectId, input.conversationId);
    });
  }

  deleteTrust(trustedResourceId: string) {
    const project = this.core.projects
      .list()
      .find((project) =>
        this.core.trust
          .list(project.id, "project_capabilities")
          .some((resource) => resource.id === trustedResourceId),
      );
    this.core.trust.delete(trustedResourceId);
    if (project) this.changed(project.id);
  }

  trust(projectId: string, expectedDigest: string) {
    return this.write(() => this.trustProject(projectId, expectedDigest));
  }

  private async trustProject(
    projectId: string,
    expectedDigest: string,
    notify = true,
  ) {
    const path = this.projectPath(projectId);
    const current = await this.read(path);
    if (current.digest === "missing" || current.digest !== expectedDigest)
      throw new Error(
        "Project capability file changed; refresh before trusting",
      );
    this.core.trust.decide({
      kind: "project_capabilities",
      projectId,
      path,
      name: "Project capabilities",
      contentDigest: current.digest,
      status: "trusted",
    });
    if (notify) this.changed(projectId);
    return this.configuration(projectId);
  }

  /**
   * The child starts from the parent's conversation overrides; the profile's
   * `tools` and `skills` are applied on top as a sparse patch.
   */
  async initializeChild(
    parentId: string,
    childId: string,
    profile: Pick<SubagentProfile, "tools" | "skills">,
    nerveSkills: readonly Skill[],
    agentBrowserSkills: readonly Skill[],
  ) {
    const { projectId } = this.core.getSnapshot(parentId).conversation;
    const parent = await this.read(this.conversationPath(projectId, parentId));
    const { inherited } = await this.configuration(projectId, parentId);
    const patch: CapabilityPatch = { tools: {}, toolSettings: {}, skills: {} };
    for (const [name, value] of Object.entries(profile.tools)) {
      const parsed = capabilityToolNameSchema.safeParse(name);
      if (!parsed.success || parsed.data === "subagents") continue;
      const tool = parsed.data;
      if (typeof value === "boolean") patch.tools![tool] = { enabled: value };
      else Object.assign(patch.toolSettings!, { [tool]: value });
    }
    if (profile.skills !== "inherit") {
      const { skills } = await listAvailableSkills(
        this.project(projectId).directory,
        {
          storageHome: this.storage.paths.home,
          nerveSkills,
          agentBrowserSkills,
        },
      );
      for (const skill of skills) {
        const enabled =
          profile.skills === "none" ? false : profile.skills[skill.name];
        if (enabled === undefined) continue;
        const kind =
          skill.source === "nerve"
            ? "nerve"
            : skill.source === "agentBrowser"
              ? "agentBrowser"
              : "file";
        (patch.skills![kind] ??= {})[skill.name] = enabled;
      }
    }
    const document = applyCapabilityPatch(parent.document, patch, inherited);
    if (parent.digest === "missing" && sameDocument(document)) return;
    await atomicWriteJson(this.conversationPath(projectId, childId), document);
  }

  /** Tell clients to refresh a project's or conversation's capability view. */
  notifyChanged(projectId: string, conversationId?: string) {
    this.changed(projectId, conversationId);
  }

  private changed(projectId: string, conversationId?: string) {
    for (const listener of this.listeners)
      listener({ projectId, ...(conversationId ? { conversationId } : {}) });
  }
}
