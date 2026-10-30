import { untrack } from "svelte";
import type {
  EffectiveAgentView,
  ProjectAgentDefaultsResult,
  LeadSettingsOverrides,
  ProfileTarget,
} from "@nervekit/contracts/agent-configuration";
import type { ThinkingLevel } from "@nervekit/contracts/models";
import type { PendingConversationState } from "../workspace/pending-conversations.svelte";
import {
  mutateDraftSettings,
  settingsOverrideView,
} from "../agent-configuration/override-view";
import { modelKey, parseModelKey } from "$lib/presentation/utils/model";

export type ComposerTarget =
  | { kind: "draft"; pendingId: string; projectId: string }
  | { kind: "conversation"; conversationId: string; readOnly: boolean };
type Store = {
  effective?: EffectiveAgentView;
  configuration?: {
    status: string;
    overrides?: LeadSettingsOverrides;
    inherited?: LeadSettingsOverrides;
  };
  configure(
    changes: LeadSettingsOverrides,
    resets?: string[],
  ): Promise<unknown>;
  setAgentProfile(name: string): Promise<unknown>;
};
export type ComposerViewDependencies = {
  target(): ComposerTarget;
  pending(): PendingConversationState | undefined;
  store(): Store | undefined;
  defaults(projectId: string): ProjectAgentDefaultsResult | undefined;
  profiles(projectId: string): readonly { name: string; digest?: string }[];
  resolve(input: {
    projectId: string;
    agentProfile?: ProfileTarget;
    overrides: LeadSettingsOverrides;
  }): Promise<ProjectAgentDefaultsResult>;
  clampReasoning(key: string, level: ThinkingLevel): ThinkingLevel;
  capabilityEditor: {
    error?: string;
    saving?: boolean;
    load(scope: {
      scope: "conversation";
      conversationId: string;
    }): Promise<void>;
    save(changes: LeadSettingsOverrides, resets?: string[]): Promise<void>;
  };
  /** Scoped notices, profile catalog changes and reconnects invalidate this pane. */
  observe(invalidate: () => void): () => void;
};

/** One configuration authority per pane. API and store bindings live at composition. */
export function createComposerView(deps: ComposerViewDependencies) {
  let revision = $state(0);
  let preview = $state<ProjectAgentDefaultsResult>();
  let loading = $state(false);
  let capabilityLoading = $state(false);
  $effect(() =>
    deps.observe(() => {
      revision += 1;
    }),
  );
  $effect(() => {
    void revision;
    const target = deps.target();
    if (target.kind !== "draft") return;
    const pending = deps.pending();
    const name = pending?.explicitAgentProfile;
    const overrides = $state.snapshot(pending?.overrides ?? {});
    if (!name && !Object.keys(overrides).length) return;
    const profile = deps
      .profiles(target.projectId)
      .find((p) => p.name === name);
    preview = undefined;
    loading = false;
    if (name && !profile?.digest) return;
    let current = true;
    loading = true;
    void deps
      .resolve({
        projectId: target.projectId,
        agentProfile: profile?.digest
          ? { name: profile.name, digest: profile.digest }
          : undefined,
        overrides,
      })
      .then((result) => {
        if (current) preview = result;
      })
      .catch(() => {
        if (current) preview = undefined;
      })
      .finally(() => {
        if (current) loading = false;
      });
    return () => {
      current = false;
    };
  });
  $effect(() => {
    void revision;
    const target = deps.target();
    capabilityLoading = false;
    if (target.kind !== "conversation" || target.readOnly) return;
    let current = true;
    capabilityLoading = true;
    void untrack(() =>
      deps.capabilityEditor.load({
        scope: "conversation",
        conversationId: target.conversationId,
      }),
    ).finally(() => {
      if (current) capabilityLoading = false;
    });
    return () => {
      current = false;
    };
  });
  const result = $derived.by(() => {
    void revision;
    const target = deps.target();
    if (target.kind === "conversation") return deps.store()?.effective;
    const pending = deps.pending();
    return !pending?.explicitAgentProfile &&
      !Object.keys(pending?.overrides ?? {}).length
      ? deps.defaults(target.projectId)
      : preview;
  });
  const available = $derived(
    result?.status === "available" ? result : undefined,
  );
  const resolution = $derived(available?.resolution);
  const locked = $derived({
    model: resolution?.provenance["/model"]?.source === "requirement",
    thinking:
      resolution?.provenance["/reasoningLevel"]?.source === "requirement",
    permission:
      resolution?.provenance["/permissionRuleSetId"]?.source === "requirement",
    compaction: Object.entries(resolution?.provenance ?? {}).some(
      ([p, v]) => p.startsWith("/compaction/") && v.source === "requirement",
    ),
  });
  const inherited = $derived(
    deps.target().kind === "draft"
      ? available && "inherited" in available
        ? available.inherited
        : undefined
      : deps.store()?.configuration?.inherited,
  );
  const readOnly = () => {
    const t = deps.target();
    return t.kind === "conversation" && t.readOnly;
  };
  async function patch(
    changes: LeadSettingsOverrides,
    resets: string[] = [],
    capabilities = false,
  ) {
    if (readOnly()) return;
    const pending = deps.pending();
    if (deps.target().kind === "draft" && pending)
      pending.overrides = mutateDraftSettings(
        pending.overrides ?? {},
        changes,
        resets,
        inherited,
      );
    else if (capabilities) await deps.capabilityEditor.save(changes, resets);
    else await deps.store()?.configure(changes, resets);
  }
  return {
    get target() {
      return deps.target();
    },
    get status(): "loading" | "ready" | "unavailable" {
      if (available)
        return resolution?.settings.model ? "ready" : "unavailable";
      const pending = deps.pending();
      const untouched =
        deps.target().kind === "draft" &&
        !pending?.explicitAgentProfile &&
        !Object.keys(pending?.overrides ?? {}).length;
      return loading ||
        (result === undefined &&
          (untouched || deps.target().kind === "conversation"))
        ? "loading"
        : "unavailable";
    },
    get error() {
      return (
        deps.capabilityEditor.error ??
        (result?.status === "unavailable"
          ? result.diagnostics.map((d) => d.message ?? d.code).join("\n")
          : available && !resolution?.settings.model
            ? "Choose an available model to configure this conversation."
            : undefined)
      );
    },
    get saving() {
      return capabilityLoading || (deps.capabilityEditor.saving ?? false);
    },
    get resolution() {
      return resolution;
    },
    get inherited() {
      return inherited;
    },
    get appliedProfile() {
      return available?.appliedProfile?.name;
    },
    get overrides() {
      return settingsOverrideView(
        deps.target().kind === "draft"
          ? (deps.pending()?.overrides ?? {})
          : (deps.store()?.configuration?.overrides ?? {}),
        inherited,
      );
    },
    get locked() {
      return locked;
    },
    async setModel(key: string, level?: ThinkingLevel) {
      if (readOnly() || locked.model) return;
      const model = parseModelKey(key);
      if (model)
        await patch({
          model,
          ...(!locked.thinking
            ? {
                reasoningLevel: deps.clampReasoning(
                  key,
                  level ?? resolution?.settings.reasoningLevel ?? "off",
                ),
              }
            : {}),
        });
    },
    async setReasoning(level: ThinkingLevel) {
      if (readOnly() || locked.thinking) return;
      const model = resolution?.settings.model;
      if (model)
        await patch({
          reasoningLevel: deps.clampReasoning(modelKey(model), level),
        });
    },
    async setPermission(id: string) {
      if (!readOnly() && !locked.permission)
        await patch(
          id ? { permissionRuleSetId: id } : {},
          id ? [] : ["/overrides/permissionRuleSetId"],
        );
    },
    async setProfile(name: string) {
      if (readOnly()) return;
      const pending = deps.pending();
      if (deps.target().kind === "draft" && pending)
        pending.explicitAgentProfile = name;
      else await deps.store()?.setAgentProfile(name);
    },
    async patchCapabilities(
      changes: LeadSettingsOverrides,
      resets: string[] = [],
    ) {
      const allowed = { ...changes };
      if (locked.model) delete allowed.model;
      if (locked.thinking) delete allowed.reasoningLevel;
      if (locked.permission) delete allowed.permissionRuleSetId;
      if (locked.compaction) delete allowed.compaction;
      const blocked = [
        ...(locked.model ? ["/overrides/model"] : []),
        ...(locked.thinking ? ["/overrides/reasoningLevel"] : []),
        ...(locked.permission ? ["/overrides/permissionRuleSetId"] : []),
        ...(locked.compaction ? ["/overrides/compaction"] : []),
      ];
      const allowedResets = resets.filter(
        (p) => !blocked.some((b) => p === b || p.startsWith(b + "/")),
      );
      if (Object.keys(allowed).length || allowedResets.length)
        await patch(allowed, allowedResets, true);
    },
  };
}
export type ComposerView = ReturnType<typeof createComposerView>;
