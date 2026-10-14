<script lang="ts">
import ChevronLeft from "@lucide/svelte/icons/chevron-left";
import Settings2 from "@lucide/svelte/icons/settings-2";
import type { Snippet } from "svelte";
import { thinkingLevels, type ModelInfo } from "@nervekit/contracts/models";
import type {
  SubagentProfileConfiguration,
  SubagentProfilePatch,
  SubagentProfilesConfiguration,
  SubagentProfileThinking,
} from "@nervekit/contracts/subagents";
import { filterCapabilityRows } from "$lib/presentation/composer/capability-list";
import {
  profileDescription,
  profileFieldValueLabel,
  profileLabel,
  profileLayerDotClasses,
  profileLayerLabels,
  profileSummaryParts,
} from "$lib/presentation/subagents/profile-layers";
import { IconAction } from "@nervekit/ui-kit/components/composites/icon-action";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import * as Select from "@nervekit/ui-kit/components/ui/select";
import { Switch } from "@nervekit/ui-kit/components/ui/switch";
import {
  conversationProfileDiagnosticLabel,
  conversationProfileProblem,
} from "./conversation-profile-diagnostics";

type QuickField = "enabled" | "model" | "thinking";

let {
  query = "",
  unavailableReason,
  configuration,
  loading,
  saving,
  error,
  models,
  delegation,
  delegationOff = false,
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
  /** Used to name models in summaries. */
  models: ModelInfo[];
  /** The Delegation master row, shown above the list. */
  delegation?: Snippet;
  /** Delegation is off: rows stay editable but dimmed. */
  delegationOff?: boolean;
  modelEditor: Snippet<[SubagentProfileConfiguration, boolean]>;
  onPatch: (name: string, patch: SubagentProfilePatch) => void;
  onRefresh: () => void;
} = $props();

/** The profile open in quick edit. */
let editing = $state<string | undefined>();

const blocked = $derived(
  saving ||
    loading ||
    !configuration ||
    configuration.diagnostics.some((d) => d.severity === "blocking"),
);
const levels: SubagentProfileThinking[] = ["lead", ...thinkingLevels];
const shared = $derived(configuration?.diagnostics ?? []);
const profiles = $derived(
  filterCapabilityRows(
    (configuration?.profiles ?? []).map((profile) => ({
      profile,
      key: profile.name,
      label: profileLabel(profile),
      searchText: `${profile.name} ${profileDescription(profile) ?? ""}`,
    })),
    query,
  ),
);
const editedProfile = $derived(
  editing
    ? configuration?.profiles.find((profile) => profile.name === editing)
    : undefined,
);

$effect(() => {
  // A profile removed elsewhere returns quick edit to the list.
  if (editing && configuration && !editedProfile) editing = undefined;
});

function changedHere(profile: SubagentProfileConfiguration): boolean {
  return Object.keys(profile.local ?? {}).length > 0;
}

function summary(profile: SubagentProfileConfiguration): string {
  return profile.effective
    ? profileSummaryParts(profile.effective, models).join(" · ")
    : "";
}

function revertTitle(
  profile: SubagentProfileConfiguration,
  field: QuickField,
): string {
  const value = profile.inherited?.[field];
  return value === undefined
    ? "Revert to the default"
    : `Revert to ${profileFieldValueLabel(field, value, models)}`;
}
</script>

{#snippet changedDot()}
  <span
    class="size-1.5 flex-none rounded-full bg-primary"
    role="img"
    aria-label="Changed for this conversation"
    title="Changed for this conversation"
  ></span>
{/snippet}

<!-- Only conversation changes are marked; inherited values need no label here. -->
{#snippet provenance(profile: SubagentProfileConfiguration, field: QuickField)}
  {#if profile.local?.[field] !== undefined}
    <span
      class="flex min-w-0 flex-none items-center gap-1 text-muted-foreground"
    >
      <span
        class={`size-1.5 flex-none rounded-full ${profileLayerDotClasses.conversation}`}
        aria-hidden="true"
      ></span>
      This conversation ·
      <Button
        size="xs"
        variant="link"
        class="h-auto px-0"
        disabled={blocked}
        title={revertTitle(profile, field)}
        onclick={() => onPatch(profile.name, { [field]: null })}>Revert</Button
      >
    </span>
  {/if}
{/snippet}

{#snippet quickEdit(profile: SubagentProfileConfiguration)}
  {@const label = profileLabel(profile)}
  {@const problem = conversationProfileProblem(profile, shared)}
  {@const thinking =
    profile.effective?.thinking ?? profile.local?.thinking ?? "lead"}
  <div class="grid min-w-0 gap-2">
    <div class="flex min-h-7 min-w-0 items-center gap-1">
      <Button
        size="icon-xs"
        variant="ghost"
        ariaLabel="Back to sub-agents"
        title="Back to sub-agents"
        onclick={() => (editing = undefined)}
      >
        <ChevronLeft aria-hidden="true" />
      </Button>
      <h3 class="min-w-0 truncate text-sm font-semibold">{label}</h3>
      {#if changedHere(profile)}{@render changedDot()}{/if}
    </div>
    {#if problem}
      <p class="px-1.5 wrap-anywhere text-warning" title={problem.detail}>
        {problem.message}
      </p>
    {/if}
    <div class="grid gap-1 px-1.5">
      <div class="flex min-h-7 min-w-0 items-center gap-2">
        <span class="min-w-0 flex-1 truncate"
          >Available in this conversation</span
        >
        {@render provenance(profile, "enabled")}
        <Switch
          size="sm"
          checked={profile.effective?.enabled ?? false}
          disabled={blocked}
          aria-label={`${label} available in this conversation`}
          onCheckedChange={(enabled) => onPatch(profile.name, { enabled })}
        />
      </div>
    </div>
    <div class="grid gap-1 px-1.5">
      <div class="flex min-w-0 items-center gap-2">
        <span class="flex-1">Model</span>
        {@render provenance(profile, "model")}
      </div>
      {@render modelEditor(profile, blocked)}
    </div>
    <div class="grid gap-1 px-1.5">
      <div class="flex min-w-0 items-center gap-2">
        <span class="flex-1">Thinking</span>
        {@render provenance(profile, "thinking")}
      </div>
      <Select.Root
        type="single"
        value={thinking}
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
          class="w-full"
          aria-label={`Thinking for ${label}`}
          >{profileFieldValueLabel(
            "thinking",
            thinking,
            models,
          )}</Select.Trigger
        >
        <Select.Content>
          {#each levels as level (level)}
            <Select.Item value={level}
              >{profileFieldValueLabel("thinking", level, models)}</Select.Item
            >
          {/each}
        </Select.Content>
      </Select.Root>
    </div>
  </div>
{/snippet}

{#snippet profileRow(profile: SubagentProfileConfiguration, label: string)}
  {@const problem = conversationProfileProblem(profile, shared)}
  {@const line = problem?.message ?? summary(profile)}
  <div
    class="flex min-h-7 min-w-0 items-center gap-2 rounded-md px-1.5 py-1 hover:bg-accent"
  >
    <div class="grid min-w-0 flex-1">
      <span class="flex min-w-0 items-center gap-1.5">
        <span class="truncate">{label}</span>
        {#if changedHere(profile)}{@render changedDot()}{/if}
      </span>
      {#if line}
        <span
          class={`truncate ${problem ? "text-warning" : "text-muted-foreground"}`}
          title={problem?.detail ?? line}>{line}</span
        >
      {/if}
    </div>
    <!-- Same order as the Tools tab: configure, then the switch on the right edge. -->
    <IconAction
      icon={Settings2}
      size="xs"
      label={`Configure ${label} for this conversation`}
      onclick={() => (editing = profile.name)}
    />
    <Switch
      size="sm"
      checked={!problem?.blocking && (profile.effective?.enabled ?? false)}
      disabled={blocked || problem?.blocking}
      aria-label={`Enable ${label} for new sub-agents in this conversation`}
      onCheckedChange={(enabled) => onPatch(profile.name, { enabled })}
    />
  </div>
{/snippet}

<div class="grid min-w-0 grid-cols-1 gap-1">
  {#if error}
    <p role="alert" class="px-1.5 wrap-anywhere text-destructive">
      {error}
      {#if !configuration && !loading}
        <Button size="xs" variant="link" class="h-auto px-0" onclick={onRefresh}
          >Retry</Button
        >
      {/if}
    </p>
  {/if}
  {#if editedProfile}
    {@render quickEdit(editedProfile)}
  {:else}
    {@render delegation?.()}
    {#if unavailableReason}
      <p class="px-1.5 text-muted-foreground">{unavailableReason}</p>
    {:else}
      {#if loading && !configuration}
        <p class="px-1.5 text-muted-foreground">Loading profiles…</p>
      {/if}
      {#each shared as diagnostic, index (index)}
        <p
          role="alert"
          class={`truncate px-1.5 ${diagnostic.severity === "blocking" ? "text-destructive" : "text-warning"}`}
          title={diagnostic.message}
        >
          {diagnostic.source
            ? `${profileLayerLabels[diagnostic.source]}: `
            : ""}{conversationProfileDiagnosticLabel(diagnostic)}
        </p>
      {/each}
      {#if configuration && profiles.length === 0}
        <p class="px-1.5 text-muted-foreground">
          {query.trim()
            ? "No sub-agent profiles match."
            : "No sub-agent profiles are available."}
        </p>
      {/if}
      <div class={`grid min-w-0 ${delegationOff ? "opacity-60" : ""}`}>
        {#each profiles as row (row.key)}
          {@render profileRow(row.profile, row.label)}
        {/each}
      </div>
    {/if}
  {/if}
</div>
