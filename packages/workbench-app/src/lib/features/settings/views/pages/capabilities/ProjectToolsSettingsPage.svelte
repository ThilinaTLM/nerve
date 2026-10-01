<script lang="ts">
import { capabilityToolsFromDisabledNames } from "@nervekit/contracts/capabilities";
import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import type {
  CapabilityConfiguration,
  CapabilityPatch,
  CapabilityToolName,
} from "@nervekit/contracts/capabilities";
import { IconAction } from "@nervekit/ui-kit/components/composites/icon-action";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Skeleton } from "@nervekit/ui-kit/components/ui/skeleton";
import { Switch } from "@nervekit/ui-kit/components/ui/switch";
import * as Tooltip from "@nervekit/ui-kit/components/ui/tooltip";
import {
  capabilityResetPatch,
  capabilityTogglePatch,
  capabilityToolState,
  type CapabilityToolState,
} from "$lib/presentation/composer/capability-origin";
import {
  SettingsGroup,
  SettingsInlineMessage,
  SettingsList,
  SettingsSection,
  SettingsToolbar,
} from "$lib/presentation/settings";
import { providerToolGroups } from "../tools/provider-tool-catalog";
import { toolGroups, type ToolGroupDef } from "../tools/tool-catalog";
import ToolConfigureButton from "../tools/ToolConfigureButton.svelte";
import ToolGroupItem from "../tools/ToolGroupItem.svelte";
import ToolProfileDialog from "../tools/ToolProfileDialog.svelte";
import ProjectCapabilityTrustNotice from "./ProjectCapabilityTrustNotice.svelte";
import ProjectCapabilityTrustAction from "./ProjectCapabilityTrustAction.svelte";

type Props = {
  configuration?: CapabilityConfiguration;
  loading?: boolean;
  error?: string;
  onPatch?: (patch: CapabilityPatch) => void;
  onReset?: () => void;
  onTrust?: (trusted: boolean) => void;
  onRetry?: () => void;
};

let {
  configuration,
  loading = false,
  error,
  onPatch,
  onReset,
  onTrust,
  onRetry,
}: Props = $props();

/** One toggle row: a catalog group, or an integration toggled as a whole. */
type ToolRow = {
  id: string;
  label: string;
  description: string;
  tools: { name: string; description: string }[];
  names: CapabilityToolName[];
};

const overrides = $derived(configuration?.project.tools ?? {});
const available = $derived(new Set(configuration?.availableTools ?? []));
const locked = $derived(
  configuration?.trust.status === "untrusted" ||
    configuration?.trust.status === "invalid",
);
const overrideCount = $derived(Object.keys(overrides).length);

let profileDialogOpen = $state(false);
let profileDialogRow = $state<ToolRow | undefined>();

function catalogRow(group: ToolGroupDef): ToolRow {
  return {
    id: group.id,
    label: group.label,
    description: group.description,
    tools: group.tools,
    names: capabilityToolsFromDisabledNames(group.configurableTools),
  };
}

const coreRows = $derived(
  toolGroups.filter((group) => group.category === "core").map(catalogRow),
);
const thirdPartyRows = $derived([
  ...toolGroups
    .filter((group) => group.category === "third-party")
    .map(catalogRow),
  ...providerToolGroups
    .filter((integration) => available.has(integration.id))
    .map((integration) => ({
      id: integration.id,
      label: integration.label,
      description: integration.description,
      tools: integration.tools,
      names: [integration.id] as CapabilityToolName[],
    })),
]);

function rowState(row: ToolRow): CapabilityToolState | undefined {
  return configuration && row.names.length > 0
    ? capabilityToolState({ configuration, level: "project", names: row.names })
    : undefined;
}

function setRow(row: ToolRow, state: CapabilityToolState, enabled: boolean) {
  onPatch?.({ tools: capabilityTogglePatch(state, row.names, enabled) });
}

function resetRow(row: ToolRow): void {
  onPatch?.({ tools: capabilityResetPatch(row.names) });
}

function openProfiles(row: ToolRow): void {
  profileDialogRow = row;
  profileDialogOpen = true;
}

const dialogState = $derived(
  profileDialogRow ? rowState(profileDialogRow) : undefined,
);

function saveProfile(profileId: string | undefined): void {
  const tool = dialogState?.profileTool;
  // No selection returns the tool to the profile from your settings.
  if (tool) onPatch?.({ tools: { [tool]: { profileId: profileId ?? null } } });
}

const sections = $derived([
  { id: "core", title: "Core", rows: coreRows },
  { id: "third-party", title: "Third party", rows: thirdPartyRows },
]);
</script>

{#if error}
  <SettingsInlineMessage tone="destructive" text={error}>
    {#snippet actions()}
      <Button size="xs" variant="outline" onclick={() => onRetry?.()}
        >Retry</Button
      >
    {/snippet}
  </SettingsInlineMessage>
{/if}

{#if !configuration && loading}
  <SettingsGroup>
    <Skeleton class="h-10 w-full" />
    <Skeleton class="h-10 w-full" />
    <Skeleton class="h-10 w-full" />
  </SettingsGroup>
{:else if configuration}
  <ProjectCapabilityTrustNotice trust={configuration.trust} {onTrust} />

  <SettingsToolbar>
    {#snippet start()}
      <p class="min-w-0 text-xs text-muted-foreground">
        {overrideCount === 0
          ? "Following your user tool settings. Toggle a group to pin it for this project."
          : `${overrideCount} tool ${overrideCount === 1 ? "override" : "overrides"} in .nerve/config/capabilities.json.`}
      </p>
    {/snippet}
    {#snippet end()}
      <Button
        size="xs"
        variant="ghost"
        class="text-muted-foreground"
        disabled={overrideCount === 0}
        onclick={() => onReset?.()}
      >
        <RotateCcw class="size-3.5" />Reset all
      </Button>
      <ProjectCapabilityTrustAction trust={configuration.trust} {onTrust} />
    {/snippet}
  </SettingsToolbar>

  {#each sections as section (section.id)}
    <SettingsSection
      id={section.id}
      title={section.title}
      info="Groups without an override follow your user settings. Provider credentials and model setup stay in user settings."
    >
      <SettingsList ariaLabel={`${section.title} tool groups`}>
        {#each section.rows as row (row.id)}
          {@const alwaysOn = row.names.length === 0}
          <ToolGroupItem
            title={row.label}
            description={row.description}
            tools={row.tools}
          >
            {#snippet actions()}
              {#if alwaysOn}
                <Tooltip.Provider delayDuration={200}>
                  <Tooltip.Root>
                    <Tooltip.Trigger>
                      {#snippet child({ props })}
                        <span {...props}>
                          <Switch
                            checked
                            disabled
                            size="settings"
                            aria-label={`${row.label} tools are always enabled`}
                          />
                        </span>
                      {/snippet}
                    </Tooltip.Trigger>
                    <Tooltip.Content side="top">Always on</Tooltip.Content>
                  </Tooltip.Root>
                </Tooltip.Provider>
              {:else}
                {@const state = rowState(row)}
                {#if state}
                  {#if state.profileMissing || state.needsProfile}
                    <span
                      class="inline-flex text-warning"
                      role="img"
                      aria-label={state.profileMissing
                        ? "Profile not found on this machine"
                        : "Choose a profile"}
                      title={state.profileMissing
                        ? "Profile not found on this machine"
                        : "Choose a profile"}
                    >
                      <TriangleAlert class="size-3.5" aria-hidden="true" />
                    </span>
                  {/if}
                  {#if state.stored}
                    <Badge variant="neutral">Project</Badge>
                    <IconAction
                      icon={RotateCcw}
                      label={`Reset ${row.label} to your user setting`}
                      onclick={() => resetRow(row)}
                    />
                  {:else}
                    <span class="text-xs text-muted-foreground"
                      >User · {state.enabled ? "On" : "Off"}</span
                    >
                  {/if}
                  {#if state.profileTool && state.profileOptions.length > 0}
                    <ToolConfigureButton
                      label={`Configure ${row.label} for this project`}
                      onclick={() => openProfiles(row)}
                    />
                  {/if}
                  <Switch
                    size="settings"
                    checked={state.enabled}
                    disabled={locked || loading}
                    aria-label={`Enable ${row.label} tools for this project`}
                    title={state.originLabel}
                    onCheckedChange={(checked) => setRow(row, state, checked)}
                  />
                {/if}
              {/if}
            {/snippet}
          </ToolGroupItem>
        {/each}
      </SettingsList>
    </SettingsSection>
  {/each}
{:else}
  <SettingsInlineMessage
    tone="neutral"
    text="Select a project to configure project tool overrides."
  />
{/if}

{#if profileDialogRow && dialogState}
  <ToolProfileDialog
    bind:open={profileDialogOpen}
    title={`Configure ${profileDialogRow.label} for this project`}
    description={`${dialogState.originLabel}. Credentials stay in your settings.`}
    profiles={dialogState.profileOptions}
    selectedProfileId={configuration?.project.tools[dialogState.profileTool!]
      ?.profileId}
    noneLabel="Use the profile from your settings"
    providerSection={dialogState.profileTool === "web_search"
      ? "tavily-profiles"
      : "atlassian-profiles"}
    onSave={saveProfile}
  />
{/if}
