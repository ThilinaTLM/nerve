import type { CapabilityOverridesDocument } from "@nervekit/contracts/capabilities";
import { isDeepStrictEqual } from "node:util";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import type { TrustedResourceService } from "@nervekit/conversation-core";
import type { ConversationConfig } from "@nervekit/contracts/core";
import {
  applySubagentProfilePatch,
  resolveSubagentProfiles,
  subagentProfileEntrySchema,
  subagentProfileNameSchema,
  subagentProfilesDocumentSchema,
  subagentProfilesPreviewParamsSchema,
  subagentProfilesReplaceConversationParamsSchema,
  type SubagentProfilesDocument,
  type SubagentProfilesLeadContext,
  type SubagentProfile,
  type SubagentProfileDiagnostic,
  type SubagentProfileLayer,
  type SubagentProfilePatch,
  type SubagentProfilesConfiguration,
  type SubagentProfileScope,
} from "@nervekit/contracts/subagents";
import type { WorkbenchNoticePublisher } from "../../infrastructure/events/index.js";
import { atomicWriteFile } from "../../infrastructure/storage-bootstrap/index.js";

export type SubagentConversationContext = {
  projectId: string;
  conversationId?: string;
  /** Creation-only captured parent values; never persisted or accepted by RPC. */
  parentConfig?: ConversationConfig;
};
export type SubagentAvailabilityContext = {
  capabilityOverrides?: CapabilityOverridesDocument;
  projectId?: string;
  conversationId?: string;
  parentConfig?: ConversationConfig;
  lead?: SubagentProfilesLeadContext;
};
export type SubagentProfileScopeInput = {
  scope: SubagentProfileScope;
  projectId?: string;
  conversationId?: string;
};
export type SubagentProfilesChange = {
  projectId?: string;
  conversationId?: string;
};
export type SubagentProfileServiceDeps = {
  userPath: string;
  conversationsPath: string;
  trust: Pick<TrustedResourceService, "decide" | "isTrusted">;
  events: Pick<WorkbenchNoticePublisher, "publish">;
  getProject: (id: string) => { id: string; directory: string };
  getConversation: (id: string) => { projectId: string };
  /** Rechecked on every conversation-aware read and child creation. */
  availability?: (
    profile: SubagentProfile,
    context: SubagentAvailabilityContext,
  ) => Promise<readonly SubagentProfileDiagnostic[]>;
};
type MutationInput = SubagentProfileScopeInput & {
  name: string;
  expectedDigest?: string | null;
};
type Target = {
  path: string;
  root: string;
  projectId?: string;
  conversationId?: string;
};
const emptyDocument = () => ({ schemaVersion: 1 as const, profiles: {} });
const digestOf = (content: string) =>
  createHash("sha256").update(content).digest("hex");

/** Filesystem/trust adapter for the transport-neutral contracts resolver. */
export class SubagentProfileService {
  private mutation = Promise.resolve();
  private readonly listeners = new Set<
    (change: SubagentProfilesChange) => void
  >();
  constructor(private readonly deps: SubagentProfileServiceDeps) {}

  async configuration(
    input: SubagentProfileScopeInput,
    parentConfig?: ConversationConfig,
  ): Promise<SubagentProfilesConfiguration> {
    const target = this.target(input);
    const layers: SubagentProfileLayer[] = [
      await this.readLayer({ scope: "user" }),
    ];
    if (input.scope !== "user" && target.projectId)
      layers.push(
        await this.readLayer({ scope: "project", projectId: target.projectId }),
      );
    if (input.scope === "conversation")
      layers.push(await this.readLayer(input));
    return this.assemble(layers, input.scope, {
      projectId: target.projectId,
      conversationId: target.conversationId,
      ...(parentConfig ? { parentConfig } : {}),
    });
  }

  async preview(input: {
    projectId: string;
    document: SubagentProfilesDocument;
    lead: SubagentProfilesLeadContext;
    capabilityOverrides?: CapabilityOverridesDocument;
  }): Promise<SubagentProfilesConfiguration> {
    const { capabilityOverrides, ...params } = input;
    const { projectId, document, lead } =
      subagentProfilesPreviewParamsSchema.parse(params);
    const layers: SubagentProfileLayer[] = [
      await this.readLayer({ scope: "user" }),
      await this.readLayer({ scope: "project", projectId }),
      { source: "conversation", document, trust: "trusted" },
    ];
    return this.assemble(layers, "conversation", {
      projectId,
      lead,
      capabilityOverrides,
    });
  }

  private async assemble(
    layers: SubagentProfileLayer[],
    scope: SubagentProfileScope,
    context: SubagentAvailabilityContext,
  ): Promise<SubagentProfilesConfiguration> {
    const result = resolveSubagentProfiles({ layers, scope });
    if (this.deps.availability) {
      for (const configuration of result.profiles) {
        if (!configuration.effective) continue;
        const diagnostics = await this.deps.availability(
          configuration.effective,
          context,
        );
        for (const diagnostic of diagnostics) {
          const duplicate = configuration.diagnostics.some(
            (existing) =>
              existing.severity === diagnostic.severity &&
              ((existing.code === diagnostic.code &&
                existing.message === diagnostic.message) ||
                (diagnostic.reference !== undefined &&
                  existing.reference === diagnostic.reference &&
                  existing.field === diagnostic.field &&
                  /^(unknown|unavailable)_(tool|skill)$/.test(existing.code) &&
                  /^(unknown|unavailable)_(tool|skill)$/.test(
                    diagnostic.code,
                  ))),
          );
          if (!duplicate) configuration.diagnostics.push(diagnostic);
        }
        const blockers = configuration.diagnostics.filter(
          (item) => item.severity === "blocking",
        );
        if (blockers.length)
          configuration.effective.error = blockers
            .map((item) => item.message)
            .join("\n");
      }
    }
    return result;
  }

  async list(
    projectId?: string,
    conversationId?: string,
    parentConfig?: ConversationConfig,
  ): Promise<SubagentProfile[]> {
    const configuration = await this.configuration(
      conversationId
        ? { scope: "conversation", projectId, conversationId }
        : projectId
          ? { scope: "project", projectId }
          : { scope: "user" },
      parentConfig,
    );
    return configuration.profiles.flatMap((profile) =>
      profile.effective ? [profile.effective] : [],
    );
  }
  async usable(
    context: SubagentConversationContext,
  ): Promise<SubagentProfile[]> {
    return (
      await this.list(
        context.projectId,
        context.conversationId,
        context.parentConfig,
      )
    ).filter(isUsable);
  }
  async find(
    context: SubagentConversationContext,
    name: string,
  ): Promise<SubagentProfile | undefined> {
    return (
      await this.list(
        context.projectId,
        context.conversationId,
        context.parentConfig,
      )
    ).find((profile) => profile.name === name);
  }
  async resolve(
    context: SubagentConversationContext,
    name: string,
  ): Promise<SubagentProfile | undefined> {
    const profile = await this.find(context, name);
    return profile && isUsable(profile) ? profile : undefined;
  }
  onChanged(listener: (change: SubagentProfilesChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  update(
    input: MutationInput & { patch: SubagentProfilePatch },
  ): Promise<SubagentProfilesConfiguration> {
    return this.mutate(async () => {
      await this.writePatch(input, input.patch);
      return this.configuration(input);
    });
  }
  reset(
    input: MutationInput & { field?: keyof SubagentProfilePatch },
  ): Promise<SubagentProfilesConfiguration> {
    return this.mutate(async () => {
      await this.writePatch(
        input,
        input.field ? { [input.field]: null } : null,
      );
      return this.configuration(input);
    });
  }
  replaceConversation(input: {
    projectId: string;
    conversationId: string;
    document: SubagentProfilesDocument;
    expectedDigest: string | null;
  }): Promise<SubagentProfilesConfiguration> {
    // Validate and snapshot before joining the mutation queue.
    const parsed = subagentProfilesReplaceConversationParamsSchema.parse(input);
    return this.mutate(async () => {
      const scope = {
        scope: "conversation" as const,
        projectId: parsed.projectId,
        conversationId: parsed.conversationId,
      };
      const target = this.target(scope);
      const layer = await this.readLayer(scope);
      if (layer.error) throw new Error(layer.error);
      const existing =
        layer.document === undefined
          ? undefined
          : subagentProfilesDocumentSchema.safeParse(layer.document);
      if (existing && !existing.success)
        throw new Error(
          "Invalid sub-agent profile document; review it before saving.",
        );
      // A lost successful response may be retried with the previous digest.
      // Only a fully valid, semantically identical document permits that retry.
      if (
        existing?.success &&
        isDeepStrictEqual(existing.data, parsed.document)
      )
        return this.configuration(scope);
      if (parsed.expectedDigest !== (layer.digest ?? null))
        throw new Error(
          "Sub-agent profile document changed; reload before saving.",
        );
      await assertProtectedPath(target);
      await mkdir(dirname(target.path), { recursive: true, mode: 0o700 });
      await assertProtectedPath(target);
      const latest = await this.readLayer(scope);
      if (latest.error || latest.digest !== layer.digest)
        throw new Error(
          "Sub-agent profile document changed; reload before saving.",
        );
      await atomicWriteFile(
        target.path,
        `${JSON.stringify(parsed.document, null, 2)}\n`,
        { mode: 0o600 },
      );
      this.notify(target);
      return this.configuration(scope);
    });
  }

  trust(
    projectId: string,
    digest: string,
  ): Promise<SubagentProfilesConfiguration> {
    return this.mutate(async () => {
      const input = { scope: "project" as const, projectId };
      const layer = await this.readLayer(input);
      if (layer.error || layer.digest !== digest)
        throw new Error(
          "Project profile document changed or is unreadable; review it again.",
        );
      // Trust is for the exact entire document, not just the named entry.
      const configuration = resolveSubagentProfiles({
        layers: [layer],
        scope: "project",
      });
      if (
        configuration.diagnostics.some(
          (item) => item.code === "invalid_document",
        )
      )
        throw new Error("Invalid project profile document cannot be trusted.");
      this.trustDocument(this.target(input), digest);
      this.notify(this.target(input));
      return this.configuration(input);
    });
  }

  private target(input: SubagentProfileScopeInput): Target {
    let projectId = input.projectId;
    if (input.conversationId) {
      if (!/^[a-zA-Z0-9_-]+$/.test(input.conversationId))
        throw new Error("Invalid conversation id.");
      const conversation = this.deps.getConversation(input.conversationId);
      if (projectId && conversation.projectId !== projectId)
        throw new Error("Conversation does not belong to this project.");
      projectId = conversation.projectId;
    }
    if (input.scope === "user")
      return { path: this.deps.userPath, root: dirname(this.deps.userPath) };
    if (!projectId) throw new Error("A project is required for this scope.");
    const project = this.deps.getProject(projectId);
    if (input.scope === "project")
      return {
        path: join(project.directory, ".nerve", "config", "subagents.json"),
        root: project.directory,
        projectId,
      };
    if (!input.conversationId)
      throw new Error("A conversation is required for conversation scope.");
    return {
      path: join(
        this.deps.conversationsPath,
        input.conversationId,
        "config",
        "subagents.json",
      ),
      root: this.deps.conversationsPath,
      projectId,
      conversationId: input.conversationId,
    };
  }
  private async readLayer(
    input: SubagentProfileScopeInput,
  ): Promise<SubagentProfileLayer> {
    const target = this.target(input);
    const layer: SubagentProfileLayer = {
      source: input.scope,
      path: target.path,
    };
    try {
      await assertProtectedPath(target);
      const content = await readFile(target.path, "utf8");
      layer.digest = digestOf(content);
      layer.trust =
        input.scope === "project" &&
        !this.deps.trust.isTrusted(
          "subagent_profile",
          target.projectId!,
          target.path,
          layer.digest,
        )
          ? "untrusted"
          : "trusted";
      try {
        layer.document = JSON.parse(content);
        layer.error = documentReadError(layer.document);
      } catch {
        layer.error =
          "subagents.json is not valid JSON. Correct its syntax before editing profiles; the file has not been changed.";
      }
    } catch (error) {
      if (!isMissing(error))
        layer.error = `Cannot read subagents.json: ${error instanceof Error ? error.message : String(error)}`;
    }
    return layer;
  }
  private async writePatch(
    input: MutationInput,
    patch: SubagentProfilePatch | null,
  ): Promise<void> {
    subagentProfileNameSchema.parse(input.name);
    const target = this.target(input);
    const layer = await this.readLayer(input);
    if (layer.error) throw new Error(layer.error);
    if (
      input.expectedDigest !== undefined &&
      input.expectedDigest !== (layer.digest ?? null)
    )
      throw new Error(
        "Sub-agent profile document changed; reload before saving.",
      );
    const raw = layer.document === undefined ? emptyDocument() : layer.document;
    // Validate the envelope, but preserve unrelated invalid entries verbatim.
    if (
      !raw ||
      typeof raw !== "object" ||
      Array.isArray(raw) ||
      (raw as { schemaVersion?: unknown }).schemaVersion !== 1 ||
      Object.keys(raw).some(
        (key) => key !== "schemaVersion" && key !== "profiles",
      )
    )
      throw new Error("Invalid sub-agent profile document.");
    const profiles = (raw as { profiles?: unknown }).profiles;
    if (!profiles || typeof profiles !== "object" || Array.isArray(profiles))
      throw new Error("Invalid profiles map.");
    for (const name of Object.keys(profiles))
      subagentProfileNameSchema.parse(name);
    const entries = { ...profiles } as Record<string, unknown>;
    if (patch === null) delete entries[input.name];
    else {
      const current = Object.hasOwn(entries, input.name)
        ? entries[input.name]
        : undefined;
      const valid =
        current === undefined ? {} : subagentProfileEntrySchema.parse(current);
      const updated = applySubagentProfilePatch(
        { schemaVersion: 1, profiles: { [input.name]: valid } },
        input.name,
        patch,
      );
      entries[input.name] = updated.profiles[input.name];
    }
    await assertProtectedPath(target);
    await mkdir(dirname(target.path), { recursive: true, mode: 0o700 });
    await assertProtectedPath(target);
    // Recheck immediately before replacement, including external edits during mkdir.
    const latest = await this.readLayer(input);
    if (latest.error || latest.digest !== layer.digest)
      throw new Error(
        "Sub-agent profile document changed; reload before saving.",
      );
    const content = `${JSON.stringify({ schemaVersion: 1, profiles: entries }, null, 2)}\n`;
    await atomicWriteFile(target.path, content, { mode: 0o600 });
    // Editing one entry is not consent to untouched imported instructions.
    // Only a new document or an already exact-content-trusted document can
    // carry trust forward; imported content requires explicit document trust.
    if (
      input.scope === "project" &&
      (layer.digest === undefined ||
        (layer.trust === "trusted" && latest.trust === "trusted"))
    )
      this.trustDocument(target, digestOf(content));
    this.notify(target);
  }
  private trustDocument(target: Target, digest: string): void {
    this.deps.trust.decide({
      kind: "subagent_profile",
      projectId: target.projectId!,
      path: target.path,
      name: "subagents.json",
      contentDigest: digest,
      status: "trusted",
    });
  }
  private notify(target: Target): void {
    const change: SubagentProfilesChange = {
      ...(target.projectId ? { projectId: target.projectId } : {}),
      ...(target.conversationId
        ? { conversationId: target.conversationId }
        : {}),
    };
    for (const listener of this.listeners) listener(change);
    void this.deps.events.publish("subagentProfiles.changed", change);
  }
  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.mutation.then(operation);
    this.mutation = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}
export function isUsable(profile: SubagentProfile): boolean {
  return !profile.error && profile.enabled && profile.trust !== "untrusted";
}
function isDocumentObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Validate only the envelope: invalid individual entries stay isolated in the resolver. */
function documentReadError(document: unknown): string | undefined {
  if (
    isDocumentObject(document) &&
    Object.keys(document).length === 1 &&
    Object.hasOwn(document, "enabled") &&
    isDocumentObject(document.enabled) &&
    Object.values(document.enabled).every((value) => typeof value === "boolean")
  )
    return "Legacy subagents.json requires storage migration to the current profile format. Back up the storage and review its migration status before editing profiles.";
  if (
    !isDocumentObject(document) ||
    document.schemaVersion !== 1 ||
    Object.keys(document).some(
      (key) => key !== "schemaVersion" && key !== "profiles",
    ) ||
    !isDocumentObject(document.profiles) ||
    Object.keys(document.profiles).some(
      (name) => !subagentProfileNameSchema.safeParse(name).success,
    )
  )
    return "Invalid subagents.json format. Expected schemaVersion: 1 and a profiles object with valid profile names. Review the file before editing; it has not been changed.";
  return undefined;
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
