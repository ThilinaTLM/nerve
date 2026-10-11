import { mkdir, readFile, realpath, rm } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import type { TrustedResourceService } from "@nervekit/conversation-core";
import {
  builtInSubagentProfiles,
  subagentProfileDraftSchema,
  type SubagentProfile,
  type SubagentProfileDraft,
  type SubagentProfileScope,
} from "@nervekit/contracts/subagents";
import type { WorkbenchNoticePublisher } from "../../infrastructure/events/index.js";
import {
  atomicWriteFile,
  pathExists,
} from "../../infrastructure/storage-bootstrap/index.js";
import type { SubagentEnablementService } from "./subagent-enablement.service.js";
import {
  contentDigest,
  loadProfileDirectory,
  serializeProfileMarkdown,
  titleFromName,
} from "./subagent-profile-files.js";

const NERVE_DIR_NAME = ".nerve";
const SUBAGENTS_DIR_NAME = "subagents";
const TRUST_KIND = "subagent_profile" as const;

type ProfileProject = { id: string; directory: string };

export type SubagentProfileServiceDeps = {
  /** `<NERVE_HOME>/agent/subagents`. */
  userDir: string;
  enablement: SubagentEnablementService;
  trust: Pick<
    TrustedResourceService,
    "list" | "decide" | "isTrusted" | "delete"
  >;
  events: Pick<WorkbenchNoticePublisher, "publish">;
  getProject: (projectId: string) => ProfileProject;
};

export type SubagentProfilesChange = { projectId?: string };

export type SaveSubagentProfileInput = {
  scope: SubagentProfileScope;
  projectId?: string;
  profile: SubagentProfileDraft;
  /** Set when renaming; the file with this name is replaced. */
  previousName?: string;
};

export type DeleteSubagentProfileInput = {
  scope: SubagentProfileScope;
  projectId?: string;
  name: string;
};

/**
 * Sub-agent profiles from built-ins, `<NERVE_HOME>/agent/subagents/*.md` and
 * `<project>/.nerve/subagents/*.md`. Project beats user beats built-in by name;
 * the first definition stays authoritative even when invalid, disabled or untrusted.
 */
export class SubagentProfileService {
  private readonly listeners = new Set<
    (change: SubagentProfilesChange) => void
  >();
  private mutation = Promise.resolve();

  constructor(private readonly deps: SubagentProfileServiceDeps) {}

  /** Every definition for Settings: effective ones first per name, then shadowed ones. */
  async list(projectId?: string): Promise<SubagentProfile[]> {
    const project = projectId ? this.deps.getProject(projectId) : undefined;
    const overrides = await this.deps.enablement.list();
    const definitions: SubagentProfile[] = [];
    if (project)
      definitions.push(
        ...(await loadProfileDirectory({
          source: "project",
          dir: projectDir(project),
        })),
      );
    definitions.push(
      ...(await loadProfileDirectory({
        source: "user",
        dir: this.deps.userDir,
      })),
      ...builtInSubagentProfiles.map(builtInRecord),
    );

    const seen = new Set<string>();
    const result: SubagentProfile[] = [];
    for (const definition of definitions) {
      const shadowed = seen.has(definition.name);
      seen.add(definition.name);
      result.push({
        ...definition,
        enabled: overrides[definition.name] ?? definition.enabled,
        ...(definition.source === "project" && project
          ? { trust: this.trustOf(project.id, definition) }
          : {}),
        ...(shadowed ? { shadowed: true } : {}),
      });
    }
    return result.sort(
      (left, right) =>
        left.name.localeCompare(right.name) ||
        Number(left.shadowed ?? false) - Number(right.shadowed ?? false),
    );
  }

  /** Enabled, valid, trusted and not shadowed: what the lead may be offered. */
  async usable(projectId: string): Promise<SubagentProfile[]> {
    return (await this.list(projectId)).filter(isUsable);
  }

  /** The effective definition for a name, usable or not (for precise errors). */
  async find(
    projectId: string,
    name: string,
  ): Promise<SubagentProfile | undefined> {
    return (await this.list(projectId)).find(
      (profile) => profile.name === name && !profile.shadowed,
    );
  }

  /** The effective definition when it is usable, otherwise undefined. */
  async resolve(
    projectId: string,
    name: string,
  ): Promise<SubagentProfile | undefined> {
    const profile = await this.find(projectId, name);
    return profile && isUsable(profile) ? profile : undefined;
  }

  onChanged(listener: (change: SubagentProfilesChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  save(input: SaveSubagentProfileInput): Promise<SubagentProfile> {
    return this.mutate(async () => {
      const profile = subagentProfileDraftSchema.parse(input.profile);
      const target = this.scopeTarget(input.scope, input.projectId);
      const previousName =
        input.previousName && input.previousName !== profile.name
          ? input.previousName
          : undefined;
      const path = join(target.dir, `${profile.name}.md`);
      if (previousName) {
        if (await pathExists(path))
          throw new Error(
            `A sub-agent profile named "${profile.name}" already exists in this scope.`,
          );
        if (!(await pathExists(join(target.dir, `${previousName}.md`))))
          throw new Error(
            `Sub-agent profile "${previousName}" was not found in this scope.`,
          );
      }
      await mkdir(target.dir, { recursive: true, mode: 0o700 });
      if (target.project)
        await assertInsideProject(target.project.directory, target.dir);
      const content = serializeProfileMarkdown(profile);
      await atomicWriteFile(path, content, { mode: 0o600 });
      // Saves made by Nerve are trusted: the user just wrote this content.
      if (target.project)
        this.trustFile(target.project.id, profile.name, path, content);
      if (previousName) await this.removeFile(target, previousName);
      this.notify(target.project?.id);
      const saved = (await this.list(target.project?.id)).find(
        (candidate) => candidate.path === path,
      );
      if (!saved)
        throw new Error("The saved sub-agent profile could not be loaded.");
      return saved;
    });
  }

  /** Deleting a user profile that edits a built-in resets it. */
  delete(input: DeleteSubagentProfileInput): Promise<void> {
    return this.mutate(async () => {
      const target = this.scopeTarget(input.scope, input.projectId);
      if (!(await pathExists(join(target.dir, `${input.name}.md`))))
        throw new Error(`Sub-agent profile "${input.name}" was not found.`);
      await this.removeFile(target, input.name);
      this.notify(target.project?.id);
    });
  }

  setEnabled(name: string, enabled: boolean): Promise<void> {
    return this.mutate(async () => {
      await this.deps.enablement.set(name, enabled);
      this.notify(undefined);
    });
  }

  /** Trusts the project file's current content, which must still match `digest`. */
  trust(
    projectId: string,
    name: string,
    digest: string,
  ): Promise<SubagentProfile> {
    return this.mutate(async () => {
      const project = this.deps.getProject(projectId);
      const path = join(projectDir(project), `${name}.md`);
      let content: string;
      try {
        content = await readFile(path, "utf8");
      } catch {
        throw new Error(`Sub-agent profile "${name}" was not found.`);
      }
      if (contentDigest(content) !== digest)
        throw new Error(
          `Sub-agent profile "${name}" changed since it was shown; review it again.`,
        );
      const profile = (await this.list(projectId)).find(
        (candidate) => candidate.path === path,
      );
      if (!profile || profile.error)
        throw new Error(
          `Sub-agent profile "${name}" is invalid and cannot be trusted.`,
        );
      this.trustFile(projectId, name, path, content);
      this.notify(projectId);
      return { ...profile, trust: "trusted" };
    });
  }

  private trustOf(
    projectId: string,
    profile: SubagentProfile,
  ): "trusted" | "untrusted" {
    return profile.path &&
      profile.digest &&
      this.deps.trust.isTrusted(
        TRUST_KIND,
        projectId,
        profile.path,
        profile.digest,
      )
      ? "trusted"
      : "untrusted";
  }

  private trustFile(
    projectId: string,
    name: string,
    path: string,
    content: string,
  ): void {
    this.deps.trust.decide({
      kind: TRUST_KIND,
      projectId,
      path,
      name,
      contentDigest: contentDigest(content),
      status: "trusted",
    });
  }

  private async removeFile(
    target: { dir: string; project?: ProfileProject },
    name: string,
  ): Promise<void> {
    const path = join(target.dir, `${name}.md`);
    await rm(path, { force: true });
    if (target.project) {
      const record = this.deps.trust
        .list(target.project.id, TRUST_KIND)
        .find((resource) => resource.path === path);
      if (record) this.deps.trust.delete(record.id);
    }
  }

  private scopeTarget(
    scope: SubagentProfileScope,
    projectId?: string,
  ): { dir: string; project?: ProfileProject } {
    if (scope === "user") return { dir: this.deps.userDir };
    if (!projectId) throw new Error("A project is required for project scope.");
    const project = this.deps.getProject(projectId);
    return { dir: projectDir(project), project };
  }

  private notify(projectId: string | undefined): void {
    const change: SubagentProfilesChange = projectId ? { projectId } : {};
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
  return (
    !profile.shadowed &&
    !profile.error &&
    profile.enabled &&
    profile.trust !== "untrusted"
  );
}

function projectDir(project: ProfileProject): string {
  return join(project.directory, NERVE_DIR_NAME, SUBAGENTS_DIR_NAME);
}

function builtInRecord(
  profile: (typeof builtInSubagentProfiles)[number],
): SubagentProfile {
  return {
    name: profile.name,
    label: profile.label ?? titleFromName(profile.name),
    description: profile.description,
    enabled: profile.enabled,
    source: "builtin",
    model: profile.model,
    thinking: profile.thinking,
    permission: profile.permission,
    compaction: profile.compaction,
    tools: profile.tools ?? {},
    skills: profile.skills,
    instructions: profile.instructions,
  };
}

async function assertInsideProject(
  projectDirectory: string,
  destinationDir: string,
): Promise<void> {
  const [root, destination] = await Promise.all([
    realpath(projectDirectory),
    realpath(destinationDir),
  ]);
  const child = relative(root, destination);
  if (
    child === "" ||
    (!child.startsWith(`..${sep}`) && child !== ".." && !isAbsolute(child))
  )
    return;
  throw new Error(
    "Sub-agent profile destination escapes the project directory.",
  );
}
