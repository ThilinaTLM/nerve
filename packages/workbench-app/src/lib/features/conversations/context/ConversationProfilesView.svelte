<script lang="ts">
import type { Snippet } from "svelte";
import { thinkingLevels } from "@nervekit/contracts/models";
import type {
  SubagentProfileConfiguration,
  SubagentProfilePatch,
  SubagentProfilesConfiguration,
  SubagentProfileThinking,
} from "@nervekit/contracts/subagents";
import { filterCapabilityRows } from "$lib/presentation/composer/capability-list";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import * as Select from "@nervekit/ui-kit/components/ui/select";
import { Switch } from "@nervekit/ui-kit/components/ui/switch";
import { conversationProfileRowDiagnostics } from "./conversation-profile-diagnostics";

let {
  query = "",
  unavailableReason,
  configuration,
  loading,
  saving,
  error,
  modelEditor,
  onPatch,
  onRefresh,
}: {
  query?: string;
  unavailableReason?: string;
  configuration?: SubagentProfilesConfiguration;
  loading: boolean;
  saving: boolean;
  error?: string;
  modelEditor: Snippet<[SubagentProfileConfiguration, boolean]>;
  onPatch: (name: string, patch: SubagentProfilePatch) => void;
  onRefresh: () => void;
} = $props();
const blocked = $derived(
  saving ||
    loading ||
    !configuration ||
    configuration.diagnostics.some((d) => d.severity === "blocking"),
);
const levels: SubagentProfileThinking[] = ["lead", ...thinkingLevels];
const profiles = $derived(
  filterCapabilityRows(
    (configuration?.profiles ?? []).map((profile) => ({
      ...profile,
      rowDiagnostics: conversationProfileRowDiagnostics(
        profile.diagnostics,
        configuration?.diagnostics ?? [],
      ),
      label:
        profile.effective?.label ??
        profile.local?.label ??
        profile.inherited?.label ??
        profile.name,
      searchText: `${profile.name} ${profile.effective?.description ?? profile.inherited?.description ?? ""}`,
    })),
    query,
  ),
);
</script>

{#if unavailableReason}
  <p class="px-1.5 text-xs text-muted-foreground">{unavailableReason}</p>
{:else}
  <div class="grid min-w-0 gap-4 px-1.5">
    <p class="text-xs text-muted-foreground">
      Profile changes apply to newly created sub-agents. Existing sub-agents
      keep their configuration. Edit existing children directly; full profile
      editing is in Settings.
    </p>
    {#if error}<p role="alert" class="wrap-anywhere text-sm text-destructive">
        {error}
      </p>{/if}
    {#if loading}<p class="text-sm text-muted-foreground">
        Loading profiles…
      </p>{/if}
    {#each configuration?.diagnostics ?? [] as diagnostic, index (index)}
      <p
        role="alert"
        class={diagnostic.severity === "blocking"
          ? "wrap-anywhere text-sm text-destructive"
          : "wrap-anywhere text-sm text-warning"}
      >
        {diagnostic.source ? `${diagnostic.source}: ` : ""}{diagnostic.message}
      </p>
    {/each}
    {#if configuration && profiles.length === 0}
      <p class="text-xs text-muted-foreground">
        {query.trim()
          ? "No sub-agent profiles match."
          : "No sub-agent profiles are available."}
      </p>
    {/if}
    {#each profiles as profile (profile.name)}
      <section class="grid min-w-0 gap-3 border-t pt-3">
        <h3 class="wrap-anywhere text-sm font-semibold">
          {profile.label}
        </h3>
        <p class="wrap-anywhere text-xs text-muted-foreground">
          {profile.name} · {profile.effective?.source ?? "Unresolved source"}
        </p>
        {#each profile.rowDiagnostics as diagnostic, index (index)}
          <p
            class={diagnostic.severity === "blocking"
              ? "wrap-anywhere text-xs text-destructive"
              : "wrap-anywhere text-xs text-warning"}
          >
            {diagnostic.source
              ? `${diagnostic.source}: `
              : ""}{diagnostic.reference
              ? `${diagnostic.reference}: `
              : ""}{diagnostic.message}
          </p>
        {/each}
        {#if profile.diagnostics.some((d) => d.severity === "warning") && !profile.diagnostics.some((d) => d.severity === "blocking")}
          <p class="text-xs text-warning">Usable with reduced capabilities.</p>
        {/if}
        <div class="flex items-center justify-between gap-2">
          <span class="text-sm"
            >Enabled <span class="text-xs text-muted-foreground"
              >({profile.origins.fields.enabled ?? "inherited"})</span
            ></span
          >
          <div class="flex shrink-0 items-center gap-2">
            <Switch
              size="sm"
              checked={profile.effective?.enabled ?? false}
              disabled={blocked}
              aria-label={`Enable ${profile.name} for newly created sub-agents`}
              onCheckedChange={(enabled) => onPatch(profile.name, { enabled })}
            />
            <Button
              size="sm"
              variant="ghost"
              disabled={blocked || profile.local?.enabled === undefined}
              onclick={() => onPatch(profile.name, { enabled: null })}
              >Reset</Button
            >
          </div>
        </div>
        {@render modelEditor(profile, blocked)}
        <div class="flex items-center justify-between gap-2">
          <span
            class="min-w-0 flex-1 wrap-anywhere text-xs text-muted-foreground"
            >Model: {profile.effective?.model ??
              profile.local?.model ??
              "Unresolved"} · {profile.origins.fields.model ??
              "inherited"}</span
          >
          <Button
            size="sm"
            variant="ghost"
            class="shrink-0"
            disabled={blocked || profile.local?.model === undefined}
            onclick={() => onPatch(profile.name, { model: null })}
            >Reset model</Button
          >
        </div>
        <div class="flex items-center justify-between gap-2">
          <span class="text-sm"
            >Thinking <span class="text-xs text-muted-foreground"
              >({profile.origins.fields.thinking ?? "inherited"})</span
            ></span
          >
          <Select.Root
            type="single"
            value={profile.effective?.thinking ??
              profile.local?.thinking ??
              "lead"}
            disabled={blocked}
            onValueChange={(value) => {
              if (levels.includes(value as SubagentProfileThinking))
                onPatch(profile.name, {
                  thinking: value as SubagentProfileThinking,
                });
            }}
          >
            <Select.Trigger
              size="sm"
              aria-label={`Thinking for ${profile.name}`}
              >{profile.effective?.thinking ??
                profile.local?.thinking ??
                "lead"}</Select.Trigger
            >
            <Select.Content
              >{#each levels as level (level)}<Select.Item value={level}
                  >{level === "lead"
                    ? "Use parent's thinking"
                    : level}</Select.Item
                >{/each}</Select.Content
            >
          </Select.Root>
          <Button
            size="sm"
            variant="ghost"
            disabled={blocked || profile.local?.thinking === undefined}
            onclick={() => onPatch(profile.name, { thinking: null })}
            >Reset</Button
          >
        </div>
        <p class="wrap-anywhere text-xs text-muted-foreground">
          Inherited: enabled {String(profile.inherited?.enabled ?? "unset")},
          model {profile.inherited?.model ?? "unset"}, thinking {profile
            .inherited?.thinking ?? "unset"}. Explicit choices stay pinned;
          reset removes the local value.
        </p>
      </section>
    {/each}
  </div>
  <Button
    size="sm"
    variant="ghost"
    disabled={loading || saving}
    onclick={onRefresh}>Refresh profiles</Button
  >
{/if}
