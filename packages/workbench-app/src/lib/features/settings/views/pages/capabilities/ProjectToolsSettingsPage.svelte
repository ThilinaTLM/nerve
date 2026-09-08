<script lang="ts">
import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
import type {
  CapabilityConfiguration,
  CapabilityPatch,
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
import {
  toolGroups,
  type ConfigurableToolName,
  type ToolCategory,
  type ToolGroupDef,
} from "../tools/tool-catalog";
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

const overrides = $derived(configuration?.project.tools ?? {});
const locked = $derived(
  configuration?.trust.status === "untrusted" ||
    configuration?.trust.status === "invalid",
);
const overrideCount = $derived(Object.keys(overrides).length);

function userEnabled(name: ConfigurableToolName): boolean {
  return !settingsDraft.tools.disabled.includes(name);
}

function groupEnabled(group: ToolGroupDef): boolean {
  return group.configurableTools.every(
    (name) => overrides[name] ?? userEnabled(name),
  );
}

function groupOverridden(group: ToolGroupDef): boolean {
  return group.configurableTools.some((name) => overrides[name] !== undefined);
}

function setGroup(group: ToolGroupDef, enabled: boolean): void {
  const tools: Record<string, boolean> = {};
  for (const name of group.configurableTools) tools[name] = enabled;
  onPatch?.({ tools });
}

function resetGroup(group: ToolGroupDef): void {
  const tools: Record<string, null> = {};
  for (const name of group.configurableTools) tools[name] = null;
  onPatch?.({ tools });
}

function inheritedLabel(group: ToolGroupDef): string {
  return group.configurableTools.every((name) => userEnabled(name))
    ? "On"
    : "Off";
}

const categories: Array<{ id: string; category: ToolCategory; title: string }> =
  [
    { id: "core", category: "core", title: "Core" },
    { id: "third-party", category: "third-party", title: "Third party" },
  ];
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

  {#each categories as section (section.id)}
    <SettingsSection
      id={section.id}
      title={section.title}
      info="Groups without an override follow your user settings. Provider and model setup stays in user settings."
    >
      <SettingsGroup>
        <SettingsList ariaLabel={`${section.title} tool groups`}>
          {#each toolGroups.filter((group) => group.category === section.category) as group (group.id)}
            {@const alwaysOn = group.configurableTools.length === 0}
            {@const overridden = groupOverridden(group)}
            <ToolGroupItem
              title={group.label}
              description={group.description}
              tools={group.tools}
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
                              aria-label={`${group.label} tools are always enabled`}
                            />
                          </span>
                        {/snippet}
                      </Tooltip.Trigger>
                      <Tooltip.Content side="top">Always on</Tooltip.Content>
                    </Tooltip.Root>
                  </Tooltip.Provider>
                {:else}
                  {#if overridden}
                    <Badge variant="neutral">Project</Badge>
                    <IconAction
                      icon={RotateCcw}
                      label={`Reset ${group.label} to your user setting`}
                      onclick={() => resetGroup(group)}
                    />
                  {:else}
                    <span class="text-xs text-muted-foreground"
                      >User · {inheritedLabel(group)}</span
                    >
                  {/if}
                  <Switch
                    size="settings"
                    checked={groupEnabled(group)}
                    disabled={locked || loading}
                    aria-label={`Enable ${group.label} tools for this project`}
                    onCheckedChange={(checked) => setGroup(group, checked)}
                  />
                {/if}
              {/snippet}
            </ToolGroupItem>
          {/each}
        </SettingsList>
      </SettingsGroup>
    </SettingsSection>
  {/each}
{:else}
  <SettingsInlineMessage
    tone="neutral"
    text="Select a project to configure project tool overrides."
  />
{/if}
