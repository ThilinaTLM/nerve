<script lang="ts">
import type {
  ModelInfo,
  ModelSelection,
  Settings,
  ThinkingLevel,
} from "$lib/api";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import Dialog from "@nervekit/ui-kit/components/composites/dialog-shell";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { Label } from "@nervekit/ui-kit/components/ui/label";
import { SettingsChoiceCards } from "$lib/presentation/settings";
import { authenticatedRealModelOptions } from "$lib/presentation/utils/model";
import ModelSelectionField from "../../shared/model-picker/ModelSelectionField.svelte";
import type { AuthProviderMetadata } from "$lib/api";
import type { SettingsChange } from "../settings-change";
import { compactionProfileItems } from "../compaction/compaction-options";
import {
  asyncSubagentPatch,
  validAsyncSubagentPercent,
} from "./async-subagent-options";

type Props = {
  open?: boolean;
  settingsDraft: Settings;
  models?: ModelInfo[];
  authProviders?: AuthProviderMetadata[];
  onSettingsChange?: SettingsChange;
};

let {
  open = $bindable(false),
  settingsDraft,
  models = [],
  authProviders = [],
  onSettingsChange,
}: Props = $props();

let modelDraft = $state<ModelSelection | undefined>();
/** Unset for older overrides saved before teammates had their own level;
 * those keep inheriting the lead's level until one is chosen. */
let thinkingDraft = $state<ThinkingLevel | undefined>();
let inheritDraft = $state(true);
let profileDraft =
  $state<Settings["asyncSubagent"]["compactionProfile"]>("inherit");
let triggerDraft = $state("80");
let keepRecentDraft = $state("15");
let lastOpen = false;

const usableModels = $derived(
  authenticatedRealModelOptions(models, authProviders),
);
const validTrigger = $derived(validAsyncSubagentPercent(triggerDraft, 60, 90));
const validKeepRecent = $derived(
  validAsyncSubagentPercent(keepRecentDraft, 5, 40),
);
const profileOptions = [
  {
    value: "inherit",
    label: "Inherit",
    detail: "Use the lead's effective project or user compaction settings",
  },
  ...compactionProfileItems,
];

$effect(() => {
  if (open && !lastOpen) {
    const current = settingsDraft.asyncSubagent;
    modelDraft = current.model;
    thinkingDraft = current.thinkingLevel;
    inheritDraft = !current.model;
    profileDraft = current.compactionProfile;
    triggerDraft = String(current.customTriggerPercent);
    keepRecentDraft = String(current.customKeepRecentPercent);
  }
  lastOpen = open;
});

function save(): void {
  const patch = asyncSubagentPatch(
    inheritDraft ? undefined : modelDraft,
    thinkingDraft,
    profileDraft,
    triggerDraft,
    keepRecentDraft,
  );
  if (!patch) return;
  settingsDraft.asyncSubagent = {
    ...settingsDraft.asyncSubagent,
    ...patch.asyncSubagent,
    model: patch.asyncSubagent.model ?? undefined,
    thinkingLevel: patch.asyncSubagent.thinkingLevel ?? undefined,
  };
  onSettingsChange?.(patch, { immediate: true });
  open = false;
}
</script>

<Dialog
  bind:open
  size="md"
  title="Configure Async Subagents"
  description="Choose the model and reasoning level for new teammates and the compaction profile for their runs."
>
  <div class="grid gap-4">
    <ModelSelectionField
      label="Teammate model"
      models={usableModels}
      bind:model={modelDraft}
      bind:thinkingLevel={thinkingDraft}
      bind:inherit={inheritDraft}
      inheritOption={{
        label: "Use the lead agent's model",
        description:
          "Teammates start with the lead's model and reasoning level.",
      }}
      hint="Model and reasoning changes apply only when a new teammate is created."
    />

    <div class="grid gap-1.5">
      <Label>Compaction profile</Label>
      <SettingsChoiceCards
        items={profileOptions}
        variant="radio"
        value={profileDraft}
        ariaLabel="Teammate compaction profile"
        onValueChange={(value) =>
          (profileDraft =
            value as Settings["asyncSubagent"]["compactionProfile"])}
      />
      <p class="text-xs text-muted-foreground">
        The global or project auto-compaction switch still applies to teammates.
      </p>
    </div>

    {#if profileDraft === "custom"}
      <div class="grid gap-3 sm:grid-cols-2">
        <div class="grid gap-1.5">
          <Label for="async-subagent-trigger">Compact at</Label>
          <div class="flex items-center gap-2">
            <Input
              id="async-subagent-trigger"
              size="sm"
              type="number"
              min={60}
              max={90}
              step={1}
              bind:value={triggerDraft}
              aria-invalid={validTrigger ? undefined : "true"}
            />
            <span class="text-xs text-muted-foreground">%</span>
          </div>
          <p
            class={validTrigger
              ? "text-xs text-muted-foreground"
              : "text-xs text-destructive"}
          >
            60–90% context used
          </p>
        </div>
        <div class="grid gap-1.5">
          <Label for="async-subagent-keep-recent">Retain recent</Label>
          <div class="flex items-center gap-2">
            <Input
              id="async-subagent-keep-recent"
              size="sm"
              type="number"
              min={5}
              max={40}
              step={1}
              bind:value={keepRecentDraft}
              aria-invalid={validKeepRecent ? undefined : "true"}
            />
            <span class="text-xs text-muted-foreground">%</span>
          </div>
          <p
            class={validKeepRecent
              ? "text-xs text-muted-foreground"
              : "text-xs text-destructive"}
          >
            5–40% kept verbatim
          </p>
        </div>
      </div>
    {/if}
  </div>

  {#snippet footer()}
    <Button size="sm" variant="ghost" onclick={() => (open = false)}
      >Cancel</Button
    >
    <Button
      size="sm"
      onclick={save}
      disabled={!validTrigger ||
        !validKeepRecent ||
        (!inheritDraft && !modelDraft)}>Save</Button
    >
  {/snippet}
</Dialog>
