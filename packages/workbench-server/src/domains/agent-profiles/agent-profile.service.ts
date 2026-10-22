import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import type { TrustedResourceService } from "@nervekit/conversation-core";
import type { ConversationConfig } from "@nervekit/contracts/core";
import type { CapabilityOverridesDocument } from "@nervekit/contracts/capabilities";
import {
  applyAgentProfilePatch,
  agentProfileDraftSchema,
  agentProfileFileSchema,
  agentProfileNameSchema,
  agentProfilesPreviewParamsSchema,
  resolveAgentProfiles,
  type AgentProfile,
  type AgentProfileDiagnostic,
  type AgentProfileLayer,
  type AgentProfilePatch,
  type AgentProfileScope,
  type AgentProfilesConfiguration,
  type AgentProfilesDraft,
  type AgentProfilesLeadContext,
} from "@nervekit/contracts/agent-profiles";
import type { WorkbenchNoticePublisher } from "../../infrastructure/events/index.js";
import {
  withFileMutation,
  atomicReplaceFile,
} from "../../infrastructure/storage-bootstrap/file-mutations.js";
import { builtInAgentProfiles } from "./builtin-agent-profiles.js";

export type AgentProfileConversationContext = {
  projectId: string;
  conversationId?: string;
  parentConfig?: ConversationConfig;
};
export type AgentProfileAvailabilityContext =
  Partial<AgentProfileConversationContext> & {
    lead?: AgentProfilesLeadContext;
    capabilityOverrides?: CapabilityOverridesDocument;
  };
export type AgentProfileScopeInput = {
  scope: AgentProfileScope;
  projectId?: string;
  conversationId?: string;
};
export type AgentProfilesChange = {
  projectId?: string;
  conversationId?: string;
};
export type AgentProfileServiceDeps = {
  userPath: string;
  trust: Pick<TrustedResourceService, "decide" | "isTrusted">;
  events: Pick<WorkbenchNoticePublisher, "publish">;
  getProject(id: string): { id: string; directory: string };
  getConversation(id: string): { projectId: string };
  availability?(
    profile: AgentProfile,
    context: AgentProfileAvailabilityContext,
  ): Promise<readonly AgentProfileDiagnostic[]>;
};
type MutationInput = AgentProfileScopeInput & {
  name: string;
  expectedDigest?: string | null;
};
type Target = { path: string; root: string; projectId?: string };
const digestOf = (content: string) =>
  createHash("sha256").update(content).digest("hex");

/** One complete template per file. Trust and concurrency never span sibling files. */
export class AgentProfileService {
  private readonly listeners = new Set<(change: AgentProfilesChange) => void>();
  constructor(private readonly deps: AgentProfileServiceDeps) {}

  private directory(input: AgentProfileScopeInput): string {
    if (input.scope === "user") return this.deps.userPath;
    if (!input.projectId) throw new Error("Project ID required");
    return join(
      this.deps.getProject(input.projectId).directory,
      ".nerve",
      "agent-profiles",
    );
  }
  private target(input: AgentProfileScopeInput, name: string): Target {
    agentProfileNameSchema.parse(name);
    const directory = this.directory(input);
    const root =
      input.scope === "user"
        ? dirname(directory)
        : this.deps.getProject(input.projectId!).directory;
    return {
      root,
      path: join(directory, `${name}.json`),
      ...(input.scope === "project" ? { projectId: input.projectId } : {}),
    };
  }
  private async readLayer(
    input: AgentProfileScopeInput,
    name: string,
  ): Promise<AgentProfileLayer | undefined> {
    const target = this.target(input, name);
    const layer: AgentProfileLayer = {
      source: input.scope,
      name,
      path: target.path,
    };
    try {
      await assertProtectedPath(target);
      const content = await readFile(target.path, "utf8");
      layer.digest = digestOf(content);
      layer.trust =
        input.scope === "project" &&
        !this.deps.trust.isTrusted(
          "agent_profile",
          input.projectId!,
          target.path,
          layer.digest,
        )
          ? "untrusted"
          : "trusted";
      try {
        layer.file = JSON.parse(content);
      } catch {
        layer.error = `${name}.json is not valid JSON; review or delete this profile before editing.`;
      }
    } catch (error) {
      if (isMissing(error)) return undefined;
      layer.error = `Cannot read ${name}.json: ${error instanceof Error ? error.message : String(error)}`;
    }
    return layer;
  }
  private async layers(input: AgentProfileScopeInput): Promise<{
    layers: AgentProfileLayer[];
    diagnostics: AgentProfileDiagnostic[];
  }> {
    const root = this.directory(input);
    // Protect the directory even when it is empty, or when readdir would follow a symlink.
    await assertProtectedPath(this.target(input, "catalog-check"));
    let names: string[];
    try {
      names = await readdir(root);
    } catch (error) {
      if (isMissing(error)) return { layers: [], diagnostics: [] };
      throw error;
    }
    const diagnostics: AgentProfileDiagnostic[] = [];
    const valid = names
      .filter((name) => name.endsWith(".json"))
      .sort()
      .filter((filename) => {
        if (agentProfileNameSchema.safeParse(filename.slice(0, -5)).success)
          return true;
        diagnostics.push({
          severity: "blocking",
          code: "invalid_filename",
          source: input.scope,
          reference: filename,
          message: `Invalid agent profile filename ${filename}; rename or remove this file.`,
        });
        return false;
      });
    const layers = (
      await Promise.all(
        valid.map((filename) => this.readLayer(input, filename.slice(0, -5))),
      )
    ).filter((layer): layer is AgentProfileLayer => layer !== undefined);
    return { layers, diagnostics };
  }

  private async assemble(
    layers: AgentProfileLayer[],
    scope: AgentProfileScope,
    context: AgentProfileAvailabilityContext,
  ): Promise<AgentProfilesConfiguration> {
    const result = resolveAgentProfiles({
      builtins: builtInAgentProfiles,
      layers,
      scope,
    });
    if (this.deps.availability)
      for (const configuration of result.profiles) {
        if (!configuration.effective) continue;
        const diagnostics = await this.deps.availability(
          configuration.effective,
          context,
        );
        configuration.diagnostics.push(...diagnostics);
        const blocking = configuration.diagnostics.filter(
          (d) => d.severity === "blocking",
        );
        if (blocking.length)
          configuration.effective.error = blocking
            .map((d) => d.message)
            .join("\n");
      }
    return result;
  }
  async configuration(
    input: AgentProfileScopeInput,
    parentConfig?: ConversationConfig,
    lead?: AgentProfilesLeadContext,
  ): Promise<AgentProfilesConfiguration> {
    const user = await this.layers({ scope: "user" });
    const project =
      input.scope === "project"
        ? await this.layers(input)
        : { layers: [], diagnostics: [] };
    const result = await this.assemble(
      [...user.layers, ...project.layers],
      input.scope,
      {
        projectId: input.projectId,
        conversationId: input.conversationId,
        parentConfig,
        lead,
      },
    );
    result.diagnostics.push(...user.diagnostics, ...project.diagnostics);
    return result;
  }
  async preview(input: {
    projectId: string;
    profiles: AgentProfilesDraft;
    lead: AgentProfilesLeadContext;
    capabilityOverrides?: CapabilityOverridesDocument;
  }): Promise<AgentProfilesConfiguration> {
    const { capabilityOverrides, ...params } = input;
    const { projectId, profiles, lead } =
      agentProfilesPreviewParamsSchema.parse(params);
    const [user, project] = await Promise.all([
      this.layers({ scope: "user" }),
      this.layers({ scope: "project", projectId }),
    ]);
    const layers = [...user.layers, ...project.layers];
    for (const profile of profiles)
      layers.push({
        source: "project",
        name: profile.name,
        file: { schemaVersion: 2, ...profile },
        trust: "trusted",
      });
    const result = await this.assemble(layers, "project", {
      projectId,
      lead,
      capabilityOverrides,
    });
    result.diagnostics.push(...user.diagnostics, ...project.diagnostics);
    return result;
  }

  async list(
    projectId?: string,
    conversationId?: string,
    parentConfig?: ConversationConfig,
    lead?: AgentProfilesLeadContext,
  ): Promise<AgentProfile[]> {
    if (conversationId) {
      const owner = this.deps.getConversation(conversationId).projectId;
      if (projectId && projectId !== owner)
        throw new Error("Conversation does not belong to project");
      projectId = owner;
    }
    const result = await this.configuration(
      projectId
        ? { scope: "project", projectId, conversationId }
        : { scope: "user" },
      parentConfig,
      lead,
    );
    return result.profiles.flatMap((p) => (p.effective ? [p.effective] : []));
  }
  async usable(context: AgentProfileConversationContext) {
    return (
      await this.list(
        context.projectId,
        context.conversationId,
        undefined,
        context.parentConfig
          ? {
              model: context.parentConfig.model,
              reasoningLevel: context.parentConfig.reasoningLevel,
            }
          : undefined,
      )
    ).filter((p) => isUsable(p) && p.usableBy !== "lead");
  }
  async find(context: AgentProfileConversationContext, name: string) {
    return (
      await this.list(
        context.projectId,
        context.conversationId,
        context.parentConfig,
      )
    ).find((p) => p.name === name);
  }
  async resolve(context: AgentProfileConversationContext, name: string) {
    const profile = await this.find(context, name);
    return profile && isUsable(profile) ? profile : undefined;
  }
  onChanged(listener: (change: AgentProfilesChange) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private notify(input: AgentProfileScopeInput) {
    const change =
      input.scope === "project" ? { projectId: input.projectId } : {};
    for (const listener of this.listeners) {
      try {
        listener(change);
      } catch {
        /* observers own errors */
      }
    }
    void this.deps.events.publish("agentProfiles.changed", change);
  }
  private trustFile(target: Target, digest: string) {
    this.deps.trust.decide({
      kind: "agent_profile",
      projectId: target.projectId!,
      path: target.path,
      name: target.path.split(sep).at(-1)!,
      contentDigest: digest,
      status: "trusted",
    });
  }
  async update(
    input: MutationInput & { patch: AgentProfilePatch },
  ): Promise<AgentProfilesConfiguration> {
    const target = this.target(input, input.name);
    let content = "";
    let authored = false;
    await atomicReplaceFile(
      target.path,
      async (handle) => {
        await handle.writeFile(content);
      },
      {
        mode: 0o600,
        prepare: async () => {
          const layer = await this.readLayer(input, input.name);
          if (
            input.expectedDigest !== undefined &&
            input.expectedDigest !== (layer?.digest ?? null)
          )
            throw new Error(
              "Agent profile file changed; reload before saving.",
            );
          if (layer?.error) throw new Error(layer.error);
          const configuration = await this.configuration(input);
          const entry = configuration.profiles.find(
            (p) => p.name === input.name,
          );
          const base = layer
            ? agentProfileFileSchema.parse(layer.file)
            : entry?.inherited;
          if (base && base.name !== input.name)
            throw new Error(
              "Profile name must match filename; delete the invalid file before editing.",
            );
          const draft = base
            ? applyAgentProfilePatch(
                agentProfileDraftSchema.parse(
                  Object.fromEntries(
                    Object.entries(base).filter(
                      ([key]) => key !== "schemaVersion",
                    ),
                  ),
                ),
                input.patch,
              )
            : agentProfileDraftSchema.parse({
                name: input.name,
                ...input.patch,
              });
          const file = agentProfileFileSchema.parse({
            schemaVersion: 2,
            ...draft,
          });
          await assertProtectedPath(target);
          await mkdir(dirname(target.path), { recursive: true, mode: 0o700 });
          await assertProtectedPath(target);
          const latest = await this.readLayer(input, input.name);
          if (latest?.digest !== layer?.digest)
            throw new Error(
              "Agent profile file changed; reload before saving.",
            );
          content = `${JSON.stringify(file, null, 2)}\n`;
          authored = !layer || layer.trust === "trusted";
          return { mode: 0o600 };
        },
      },
    );
    if (target.projectId && authored) this.trustFile(target, digestOf(content));
    this.notify(input);
    return this.configuration(input);
  }
  async reset(
    input: MutationInput & { field?: string },
  ): Promise<AgentProfilesConfiguration> {
    if (input.field) {
      const entry = (await this.configuration(input)).profiles.find(
        (p) => p.name === input.name,
      );
      const field = input.field;
      if (["name", "schemaVersion"].includes(field))
        throw new Error("Cannot reset profile identity");
      const inherited = entry?.inherited as Record<string, unknown> | undefined;
      return this.update({
        ...input,
        patch: { [field]: inherited?.[field] ?? null },
      });
    }
    const target = this.target(input, input.name);
    await withFileMutation(target.path, async () => {
      const layer = await this.readLayer(input, input.name);
      if (
        input.expectedDigest !== undefined &&
        input.expectedDigest !== (layer?.digest ?? null)
      )
        throw new Error("Agent profile file changed; reload before deleting.");
      await assertProtectedPath(target);
      await rm(target.path, { force: true });
      this.notify(input);
    });
    return this.configuration(input);
  }
  async trust(
    projectId: string,
    name: string,
    digest: string,
  ): Promise<AgentProfilesConfiguration> {
    const input = { scope: "project" as const, projectId };
    const target = this.target(input, name);
    await withFileMutation(target.path, async () => {
      const layer = await this.readLayer(input, name);
      if (!layer || layer.error || layer.digest !== digest)
        throw new Error(
          "Project profile file changed or is unreadable; review it again.",
        );
      const file = agentProfileFileSchema.parse(layer.file);
      if (file.name !== name)
        throw new Error("Profile name must match filename");
      this.trustFile(target, digest);
      this.notify(input);
    });
    return this.configuration(input);
  }
}
export function isUsable(profile: AgentProfile): boolean {
  return !profile.error && profile.enabled && profile.trust !== "untrusted";
}
function isMissing(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
/** Inspect every existing component before mkdir/write: never follow a configuration symlink. */
async function assertProtectedPath(target: Target): Promise<void> {
  const child = relative(target.root, target.path);
  if (
    !child ||
    child === ".." ||
    child.startsWith(`..${sep}`) ||
    isAbsolute(child)
  )
    throw new Error("Profile path escapes its owner.");
  // A fresh scope may not exist yet. Find an existing ancestor without creating
  // anything, then inspect all intervening components before recursive mkdir.
  let ancestor = target.root;
  while (true) {
    try {
      await lstat(ancestor);
      break;
    } catch (error) {
      if (!isMissing(error)) throw error;
      ancestor = dirname(ancestor);
    }
  }
  if ((await lstat(ancestor)).isSymbolicLink())
    throw new Error("Profile configuration must not use symbolic links.");
  const root = await realpath(ancestor);
  let current = root;
  for (const part of relative(ancestor, target.path).split(sep)) {
    current = join(current, part);
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink())
        throw new Error("Profile configuration must not use symbolic links.");
    } catch (error) {
      if (isMissing(error)) return;
      throw error;
    }
  }
}
