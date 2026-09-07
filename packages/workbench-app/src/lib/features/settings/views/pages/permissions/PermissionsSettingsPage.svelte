<script lang="ts">
import RefreshCw from "@lucide/svelte/icons/refresh-cw";
import SlidersHorizontal from "@lucide/svelte/icons/sliders-horizontal";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { IconAction } from "@nervekit/ui-kit/components/composites/icon-action";
import * as RadioGroup from "@nervekit/ui-kit/components/ui/radio-group";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import type { ProjectRecord, Settings } from "$lib/api";
import {
  SettingsInlineMessage,
  SettingsList,
  SettingsListItem,
  SettingsSection,
} from "$lib/presentation/settings";
import type { SettingsChange } from "../settings-change";
import PermissionOverlaysDialog from "./PermissionOverlaysDialog.svelte";
import {
  isDefaultEligible,
  overlaySummary,
  ruleSetRole,
} from "./permission-rule-sets-view";
import type { PermissionsPageState } from "./permissions-page-state.svelte";

type Props = {
  settingsDraft: Settings;
  activeProject?: ProjectRecord;
  controller: PermissionsPageState;
  onSettingsChange?: SettingsChange;
};

let { settingsDraft, activeProject, controller, onSettingsChange }: Props =
  $props();

let overlaysOpen = $state(false);
let overlayRuleSetName = $state("");

$effect(() => controller.selectProject(activeProject));

const defaultRuleSetId = $derived(
  settingsDraft.defaultPermissionRuleSetId ??
    settingsDraft.defaultPermissionLevel,
);
const ruleSets = $derived(controller.configuration?.ruleSets ?? []);
const overlayRows = $derived(
  ruleSets.filter((ruleSet) => {
    if (isDefaultEligible(ruleSet)) return true;
    const summary = controller.configuration
      ? overlaySummary(controller.configuration, ruleSet.id)
      : undefined;
    return Boolean(summary && summary.project + summary.user > 0);
  }),
);
const managedRuleSet = $derived(
  ruleSets.find((ruleSet) => ruleSet.id === controller.overlayRuleSetId),
);

function setDefaultPermission(value: string): void {
  settingsDraft.defaultPermissionRuleSetId = value;
  if (["read_only", "supervised", "autonomous"].includes(value)) {
    const permission = value as Settings["defaultPermissionLevel"];
    settingsDraft.defaultPermissionLevel = permission;
    onSettingsChange?.(
      {
        defaultPermissionLevel: permission,
        defaultPermissionRuleSetId: value,
      },
      { immediate: true },
    );
    return;
  }
  onSettingsChange?.(
    { defaultPermissionRuleSetId: value },
    { immediate: true },
  );
}

function manageOverlays(ruleSetId: string, name: string): void {
  controller.selectRuleSet(ruleSetId);
  overlayRuleSetName = name;
  overlaysOpen = true;
}
</script>

<SettingsSection
  id="rule-sets"
  title="Permission rule sets"
  info="Choose the rule set new coding agents start with. Built-in sets are read-only; add user sets under <NERVE_HOME>/config/rule-sets/*.json."
>
  {#snippet actions()}
    <Button
      size="xs"
      variant="outline"
      disabled={!activeProject || controller.loading}
      onclick={() => controller.refresh()}
    >
      <RefreshCw
        class={`size-3.5 ${controller.loading ? "animate-spin" : ""}`}
      />Refresh
    </Button>
  {/snippet}

  {#if ruleSets.length > 0}
    <RadioGroup.Root
      value={defaultRuleSetId}
      onValueChange={setDefaultPermission}
    >
      <SettingsList ariaLabel="Permission rule sets">
        {#each ruleSets as ruleSet (ruleSet.id)}
          {@const eligible = isDefaultEligible(ruleSet)}
          <SettingsListItem
            title={ruleSet.name}
            description={ruleSet.description}
            class={ruleSet.enabled && ruleSet.available
              ? undefined
              : "opacity-55"}
          >
            {#snippet leading()}
              {#if eligible}
                <RadioGroup.Item
                  value={ruleSet.id}
                  id={`rule-set-${ruleSet.id}`}
                  aria-label={`Make ${ruleSet.name} the default rule set`}
                  data-tour-id={ruleSet.id === defaultRuleSetId
                    ? "setup-agent-default-permission"
                    : undefined}
                />
              {:else}
                <span class="size-4 flex-none" aria-hidden="true"></span>
              {/if}
            {/snippet}
            {#snippet status()}
              {#if ruleSet.id === defaultRuleSetId}
                <Badge variant="accent">Default</Badge>
              {/if}
              {#if ruleSet.source === "user"}
                <Badge variant="neutral">User</Badge>
              {/if}
              {#if !ruleSet.available}
                <Badge variant="warning">Unavailable</Badge>
              {:else if !ruleSet.enabled}
                <Badge variant="neutral">Disabled</Badge>
              {/if}
            {/snippet}
            {#snippet detail()}
              <span class="whitespace-nowrap">{ruleSetRole(ruleSet)}</span>
            {/snippet}
          </SettingsListItem>
        {/each}
      </SettingsList>
    </RadioGroup.Root>
  {:else if controller.loading}
    <div class="flex items-center gap-2 py-2 text-sm text-muted-foreground">
      <Spinner class="size-4" />Loading permission rule sets…
    </div>
  {/if}
</SettingsSection>

<SettingsSection
  id="overlays"
  title="Overrides"
  info="Project and user rules layered on top of a rule set. Open a rule set to review or edit its overrides."
>
  {#if overlayRows.length > 0 && controller.configuration}
    <SettingsList ariaLabel="Permission overrides">
      {#each overlayRows as ruleSet (ruleSet.id)}
        {@const summary = overlaySummary(controller.configuration, ruleSet.id)}
        <SettingsListItem title={ruleSet.name}>
          {#snippet status()}
            {#if summary.project > 0 && controller.configuration?.projectTrust?.status !== "trusted"}
              <Badge variant="warning">Untrusted</Badge>
            {/if}
          {/snippet}
          {#snippet detail()}
            <span class="whitespace-nowrap">{summary.label}</span>
          {/snippet}
          {#snippet actions()}
            <IconAction
              icon={SlidersHorizontal}
              label={`Manage ${ruleSet.name} overrides`}
              onclick={() => manageOverlays(ruleSet.id, ruleSet.name)}
            />
          {/snippet}
        </SettingsListItem>
      {/each}
    </SettingsList>
  {:else if !controller.loading}
    <SettingsInlineMessage
      tone="info"
      text="Select a project to review its permission overrides."
    />
  {/if}
</SettingsSection>

{#if controller.errorMessage}
  <SettingsInlineMessage tone="destructive" text={controller.errorMessage}>
    {#snippet actions()}
      <Button size="xs" variant="outline" onclick={() => controller.retry()}
        >Retry</Button
      >
    {/snippet}
  </SettingsInlineMessage>
{/if}

{#each controller.configuration?.diagnostics ?? [] as diagnostic (diagnostic)}
  <SettingsInlineMessage tone="warning" text={diagnostic} />
{/each}

<PermissionOverlaysDialog
  bind:open={overlaysOpen}
  {controller}
  ruleSetId={controller.overlayRuleSetId}
  ruleSetName={overlayRuleSetName}
  editable={Boolean(managedRuleSet?.available && managedRuleSet.enabled)}
  hasProject={Boolean(activeProject)}
/>
