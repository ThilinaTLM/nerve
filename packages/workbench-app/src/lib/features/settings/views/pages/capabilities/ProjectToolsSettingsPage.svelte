<script lang="ts">
import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
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
import type { Settings } from "$lib/api";
import {
  SettingsGroup,
  SettingsInlineMessage,
  SettingsList,
  SettingsSection,
  SettingsToolbar,
} from "$lib/presentation/settings";
import { providerToolGroups } from "../tools/provider-tool-catalog";
import { toolGroups, type ToolGroupDef } from "../tools/tool-catalog";
import ToolGroupItem from "../tools/ToolGroupItem.svelte";
import ProjectCapabilityTrustNotice from "./ProjectCapabilityTrustNotice.svelte";

type Props = {
  configuration?: CapabilityConfiguration;
  settingsDraft: Settings;
  loading?: boolean;
  error?: string;
  onPatch?: (patch: CapabilityPatch) => void;
  onReset?: () => void;
  onTrust?: (trusted: boolean) => void;
  onRetry?: () => void;
};

let {
  configuration,
  settingsDraft,
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

function catalogRow(group: ToolGroupDef): ToolRow {
  return {
    id: group.id,
    label: group.label,
    description: group.description,
    tools: group.tools,
    names: group.configurableTools,
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

function userEnabled(name: CapabilityToolName): boolean {
  if (name === "jira") return settingsDraft.tools.jira.enabled;
  if (name === "confluence") return settingsDraft.tools.confluence.enabled;
  return !settingsDraft.tools.disabled.includes(name);
}

function rowEnabled(row: ToolRow): boolean {
  return row.names.every((name) => overrides[name] ?? userEnabled(name));
}

function rowOverridden(row: ToolRow): boolean {
  return row.names.some((name) => overrides[name] !== undefined);
}

function inheritedLabel(row: ToolRow): string {
  return row.names.every((name) => userEnabled(name)) ? "On" : "Off";
}

function setRow(row: ToolRow, enabled: boolean): void {
  const tools: Record<string, boolean> = {};
  for (const name of row.names) tools[name] = enabled;
  onPatch?.({ tools });
}

function resetRow(row: ToolRow): void {
  const tools: Record<string, null> = {};
  for (const name of row.names) tools[name] = null;
  onPatch?.({ tools });
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
                {#if rowOverridden(row)}
                  <Badge variant="neutral">Project</Badge>
                  <IconAction
                    icon={RotateCcw}
                    label={`Reset ${row.label} to your user setting`}
                    onclick={() => resetRow(row)}
                  />
                {:else}
                  <span class="text-xs text-muted-foreground"
                    >User · {inheritedLabel(row)}</span
                  >
                {/if}
                <Switch
                  size="settings"
                  checked={rowEnabled(row)}
                  disabled={locked || loading}
                  aria-label={`Enable ${row.label} tools for this project`}
                  onCheckedChange={(checked) => setRow(row, checked)}
                />
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
