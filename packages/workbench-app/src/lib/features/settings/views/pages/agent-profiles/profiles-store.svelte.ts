import {
  profileDefinitionSchema,
  type ListScopedProfilesResult,
  type PreferenceScope,
  type ProfileDefinition,
} from "@nervekit/contracts/agent-configuration";
import { ScopedAgentState } from "$lib/application/agent-configuration/scoped-agent-state.svelte";
import { agentProfileCatalog } from "$lib/application/agent-profiles/agent-profile-catalog.svelte";
import { requestWorkbench } from "$lib/application/startup/workbench-connection";
import {
  readAgentProfiles,
  readScopedProfile,
  resetAgentProfile,
  saveScopedProfile,
} from "../../../api/agent-profiles.api";
import { applyLayerChange } from "../../shared/layer-change";
import type { Layered } from "../../../state/layered";
import type { SettingsLayer } from "$lib/presentation/settings";
import {
  applyProfileChange,
  duplicateProfileName,
  uniqueProfileName,
} from "./profile-changes";
import type { ChangeDraft } from "./profile-edit-context";
import {
  groupProfiles,
  profileRowId,
  type ProfileOrigin,
  type ProfileRow,
} from "./profile-groups";
import type { ProfileKind } from "./profile-kind";

export type ProfileHeadPatch = Partial<
  Pick<ProfileDefinition, "label" | "whenToUse" | "usableBy">
>;

const pointerOf = (name: string) =>
  `/overrides/subagents/${name.replaceAll("~", "~0").replaceAll("/", "~1")}`;

/**
 * The profile files the Agents and Sub-Agents pages edit: the user listing
 * (user and built-in profiles), the open project's listing, and the two
 * layers' launch settings. Every write goes to the file's own layer.
 */
export class ProfilesStore {
  user = $state.raw<ListScopedProfilesResult>();
  project = $state.raw<ListScopedProfilesResult>();
  error = $state<string>();
  busy = $state<string>();
  errors = $state<Record<string, string>>({});
  projectId = $state<string>();
  readonly userEditor = new ScopedAgentState();
  readonly projectEditor = new ScopedAgentState();
  private request = 0;

  get loaded(): boolean {
    return !!this.user && (!this.projectId || !!this.project);
  }

  /** The project's agent.json is not trusted: its launch switches are locked. */
  get launchLocked(): boolean {
    const document = this.projectEditor.document;
    return (
      !!this.projectId &&
      document?.status === "available" &&
      (document.trustState ?? "trusted") !== "trusted"
    );
  }

  rows(kind?: ProfileKind) {
    return groupProfiles({
      user: this.user?.profiles,
      project: this.projectId ? this.project?.profiles : undefined,
      kind,
    });
  }

  find(id: string): ProfileRow | undefined {
    const groups = this.rows();
    return [...groups.project, ...groups.user, ...groups.builtin].find(
      (row) => row.id === id,
    );
  }

  /** Every ID in use, whichever origin it comes from. */
  private names(): string[] {
    return [
      ...(this.user?.profiles ?? []).map((entry) => entry.name),
      ...(this.project?.profiles ?? []).map((entry) => entry.name),
    ];
  }

  scopeOf(origin: ProfileOrigin): PreferenceScope | undefined {
    if (origin === "user") return { scope: "user" };
    if (origin === "project" && this.projectId)
      return { scope: "project", projectId: this.projectId };
    return undefined;
  }

  editorOf(origin: ProfileOrigin): ScopedAgentState {
    return origin === "project" ? this.projectEditor : this.userEditor;
  }

  async load(projectId: string | undefined): Promise<void> {
    if (projectId !== this.projectId) {
      this.project = undefined;
      this.projectId = projectId;
    }
    await this.reload();
  }

  /** Reads both listings again (and the pickers' catalog). */
  async reload(): Promise<void> {
    const request = ++this.request;
    const projectId = this.projectId;
    try {
      const [user, project] = await Promise.all([
        readAgentProfiles({ scope: "user" }),
        projectId
          ? readAgentProfiles({ scope: "project", projectId })
          : undefined,
      ]);
      if (request !== this.request) return;
      this.user = user;
      this.project = project;
      this.error = undefined;
      await agentProfileCatalog.refresh(projectId);
    } catch (error) {
      if (request === this.request)
        this.error = error instanceof Error ? error.message : String(error);
    }
  }

  /** Re-reads the files from disk, then the listings. */
  async reloadFiles(rows?: ProfileRow[]): Promise<void> {
    try {
      const all = this.rows();
      const targets = rows ?? [...all.project, ...all.user];
      for (const row of targets) {
        const scope = this.scopeOf(row.origin);
        if (scope)
          await requestWorkbench("agentConfiguration.reload", {
            target: { document: "profile", scope, name: row.name },
          });
        delete this.errors[row.id];
      }
      await this.reload();
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    }
  }

  private async mutate(
    id: string,
    action: () => Promise<{ status: string }>,
  ): Promise<boolean> {
    if (this.busy) return false;
    this.busy = id;
    delete this.errors[id];
    try {
      const result = await action();
      if (result.status !== "saved")
        throw new Error(
          `${result.status}: reload and review before saving again.`,
        );
      await this.reload();
      return true;
    } catch (error) {
      this.errors[id] = error instanceof Error ? error.message : String(error);
      return false;
    } finally {
      this.busy = undefined;
    }
  }

  private async snapshot(row: ProfileRow) {
    const scope = this.scopeOf(row.origin);
    if (!scope) throw new Error("Built-in profiles are read-only.");
    const current = this.find(row.id) ?? row;
    const read = await readScopedProfile(scope, row.name);
    if (read.status !== "available")
      throw new Error(`Profile ${read.status}; reload before editing.`);
    if (
      read.profile.digest !== current.entry.digest ||
      !read.profile.definition
    )
      throw new Error("Profile changed; reload before editing.");
    return {
      scope,
      profile: read.profile,
      definition: structuredClone(read.profile.definition),
      expectedDigest: read.localDigest,
    };
  }

  private fail(row: ProfileRow, message: string): never {
    this.errors[row.id] ||= message;
    throw new Error(this.errors[row.id]);
  }

  /** Saves a whole definition as a new file in `layer`; resolves to the new row's id. */
  private async createFile(
    layer: "user" | "project",
    definition: ProfileDefinition,
  ): Promise<string> {
    const scope = this.scopeOf(layer);
    if (!scope) throw new Error("Open a project first.");
    const id = profileRowId(layer, definition.name);
    const ok = await this.mutate(id, () =>
      saveScopedProfile({
        scope,
        name: definition.name,
        expectedDigest: "missing",
        definition: profileDefinitionSchema.parse(definition),
      }),
    );
    if (!ok) {
      const message = this.errors[id] ?? "Could not create the profile.";
      delete this.errors[id];
      throw new Error(message);
    }
    return id;
  }

  /** A blank profile of `kind` in `layer`. */
  createProfile(layer: "user" | "project", kind: ProfileKind) {
    return this.createFile(layer, {
      schemaVersion: 1,
      name: uniqueProfileName("new-profile", this.names()),
      label: "New profile",
      whenToUse: "Describe when to use this profile.",
      instructions: "",
      usableBy: kind,
    });
  }

  /** A copy under a new ID, in the profile's own layer (built-in ones go to User). */
  duplicate(row: ProfileRow) {
    const source = row.entry.definition;
    if (!source) throw new Error("This profile has no readable definition.");
    return this.createFile(row.origin === "project" ? "project" : "user", {
      ...structuredClone($state.snapshot(source)),
      name: uniqueProfileName(duplicateProfileName(row.name), this.names()),
      label: `${source.label ?? row.name} copy`,
    });
  }

  /** A copy with the same ID in `layer`, which replaces the profile there. */
  customize(row: ProfileRow, layer: "user" | "project") {
    const source = row.entry.definition;
    if (!source) throw new Error("This profile has no readable definition.");
    return this.createFile(layer, structuredClone($state.snapshot(source)));
  }

  async saveHead(row: ProfileRow, head: ProfileHeadPatch): Promise<void> {
    try {
      const base = await this.snapshot(row);
      const next = { ...base.definition, ...head };
      if (!next.label?.trim()) delete next.label;
      const ok = await this.mutate(row.id, () =>
        saveScopedProfile({
          scope: base.scope,
          name: row.name,
          expectedDigest: base.expectedDigest,
          definition: profileDefinitionSchema.parse(next),
        }),
      );
      if (!ok) this.fail(row, "Could not save the profile.");
    } catch (error) {
      this.fail(row, error instanceof Error ? error.message : String(error));
    }
  }

  async persistChange(row: ProfileRow, change: ChangeDraft): Promise<void> {
    const base = await this.snapshot(row);
    const ok = await this.mutate(row.id, () =>
      saveScopedProfile({
        scope: base.scope,
        name: row.name,
        expectedDigest: base.expectedDigest,
        definition: applyProfileChange(base.definition, change),
      }),
    );
    if (!ok) this.fail(row, "Could not save profile.");
  }

  /** Deletes the file; a copy that replaced a lower profile reveals it again. */
  async remove(row: ProfileRow): Promise<boolean> {
    try {
      const base = await this.snapshot(row);
      return await this.mutate(row.id, () =>
        resetAgentProfile({
          scope: base.scope,
          name: row.name,
          expectedDigest: base.expectedDigest,
        }),
      );
    } catch (error) {
      this.errors[row.id] =
        error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  /** The launch switch of a sub-agent profile: what each layer chose, and what shows. */
  launch(row: ProfileRow) {
    const builtinDefault = row.entry.definition?.enabled ?? true;
    const value: Layered<boolean> = {
      builtinDefault,
      user: this.userEditor.overrides.subagents?.[row.name]?.enabled,
      project: this.projectId
        ? this.projectEditor.overrides.subagents?.[row.name]?.enabled
        : undefined,
    };
    const user = value.user ?? builtinDefault;
    return {
      value,
      user,
      project: value.project ?? user,
      projectSet: value.project !== undefined,
    };
  }

  setLaunch(row: ProfileRow, layer: SettingsLayer, next: boolean) {
    const write =
      (editor: ScopedAgentState) => async (choice: boolean | undefined) =>
        choice === undefined
          ? editor.save({}, [`${pointerOf(row.name)}/enabled`])
          : editor.save({ subagents: { [row.name]: { enabled: choice } } });
    return applyLayerChange({
      value: this.launch(row).value,
      layer,
      next,
      writeUser: write(this.userEditor),
      writeProject: write(this.projectEditor),
    });
  }

  /**
   * A model chosen for launches in an earlier version of this page. It
   * outranks the profile's recommended model, so the detail surfaces it until
   * it is cleared. Only a differing choice matters.
   */
  launchModelOverrides(row: ProfileRow) {
    const definition = row.entry.definition;
    const model =
      definition?.requirements?.model ?? definition?.recommendations?.model;
    const level =
      definition?.requirements?.reasoningLevel ??
      definition?.recommendations?.reasoningLevel;
    return (
      [
        ["user", this.userEditor],
        ...(this.projectId ? [["project", this.projectEditor] as const] : []),
      ] as const
    ).flatMap(([layer, editor]) => {
      const own = editor.overrides.subagents?.[row.name];
      if (!own?.model && !own?.reasoningLevel) return [];
      const sameModel =
        !own.model ||
        (own.model.provider === model?.provider &&
          own.model.modelId === model?.modelId);
      const sameLevel = !own.reasoningLevel || own.reasoningLevel === level;
      return sameModel && sameLevel ? [] : [{ layer, editor, own }];
    });
  }

  clearLaunchModel(row: ProfileRow, editor: ScopedAgentState) {
    const pointer = pointerOf(row.name);
    return editor.save({}, [`${pointer}/model`, `${pointer}/reasoningLevel`]);
  }
}
