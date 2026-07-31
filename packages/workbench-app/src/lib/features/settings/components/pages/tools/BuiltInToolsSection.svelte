<script lang="ts">
import { SvelteSet } from "svelte/reactivity";
import type { AuthProviderMetadata, Settings, StatusResponse } from "$lib/api";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Switch } from "@nervekit/ui-kit/components/ui/switch";
import * as Tooltip from "@nervekit/ui-kit/components/ui/tooltip";
import {
  SettingsDisclosureItem,
  SettingsFieldRow,
  SettingsGroup,
  SettingsInlineMessage,
  SettingsList,
  SettingsSummaryRow,
  SettingsToggleRow,
} from "$lib/presentation/components/settings";
import type { SettingsChange } from "../settings-change";
import PythonRuntimeDialog from "./PythonRuntimeDialog.svelte";
import TavilyKeyDialog from "./TavilyKeyDialog.svelte";
import {
  configurableToolOrder,
  toolGroups,
  type ConfigurableToolName,
  type ToolGroupDef,
} from "./tool-catalog";
import { ensureToolsDraft } from "./tools-draft";

type Props = {
  settingsDraft: Settings;
  status?: StatusResponse;
  authProviders?: AuthProviderMetadata[];
  onSettingsChange?: SettingsChange;
};

const tavilyProviderId = "tavily";

let {
  settingsDraft,
  status,
  authProviders = [],
  onSettingsChange,
}: Props = $props();

let tavilyDialogOpen = $state(false);
let pythonDialogOpen = $state(false);

const disabledTools = $derived(new Set(settingsDraft.tools?.disabled ?? []));
const python = $derived(status?.runtime.python);
const sourceLabel = $derived(
  (python?.source ?? "unavailable").replace(/_/g, " "),
);
const tavilyProvider = $derived(
  authProviders.find((provider) => provider.provider === tavilyProviderId),
);
const tavilyConfigured = $derived(
  Boolean(
    tavilyProvider?.configured && tavilyProvider.credentialType === "api_key",
  ),
);
const tavilyDisplayName = $derived(tavilyProvider?.displayName ?? "Tavily");
const bashAutoPromotion = $derived(settingsDraft.tools.bash.autoPromotion);

function groupEnabled(group: ToolGroupDef): boolean {
  if (group.configurableTools.length === 0) return true;
  return group.configurableTools.every((name) => !disabledTools.has(name));
}

function setToolsEnabled(
  names: ConfigurableToolName[],
  enabled: boolean,
): void {
  const tools = ensureToolsDraft(settingsDraft);
  const next = new SvelteSet(tools.disabled);
  for (const name of names) {
    if (enabled) next.delete(name);
    else next.add(name);
  }
  const disabled = configurableToolOrder.filter((name) => next.has(name));
  tools.disabled = disabled;
  onSettingsChange?.({ tools: { disabled } }, { immediate: true });
}

function setBashAutoPromotionEnabled(enabled: boolean): void {
  settingsDraft.tools.bash.autoPromotion.enabled = enabled;
  onSettingsChange?.(
    { tools: { bash: { autoPromotion: { enabled } } } },
    { immediate: true },
  );
}

function updateBashAutoPromotionSeconds(value: string): void {
  const seconds = Number(value);
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 86_400) return;
  const afterMs = seconds * 1000;
  settingsDraft.tools.bash.autoPromotion.afterMs = afterMs;
  onSettingsChange?.(
    { tools: { bash: { autoPromotion: { afterMs } } } },
    { debounceMs: 650 },
  );
}
</script>

<SettingsGroup>
  <SettingsList ariaLabel="Built-in tool groups">
    {#each toolGroups as group (group.id)}
      {@const enabled = groupEnabled(group)}
      {@const alwaysOn = group.configurableTools.length === 0}
      <SettingsDisclosureItem
        title={group.label}
        description={group.description}
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
            <Switch
              size="settings"
              checked={enabled}
              aria-label={`Enable ${group.label} tools`}
              onCheckedChange={(checked) =>
                setToolsEnabled(group.configurableTools, checked)}
            />
          {/if}
        {/snippet}
        {#snippet detail()}
          <ul class="grid gap-1" aria-label={`${group.label} tools`}>
            {#each group.tools as tool (tool.name)}
              <li class="min-w-0">
                <span class="font-mono text-foreground">{tool.name}</span>
                <span> — {tool.description}</span>
              </li>
            {/each}
          </ul>

          {#if group.id === "shell"}
            <div class="grid gap-2 pt-1">
              <SettingsToggleRow
                label="Automatic backgrounding"
                description="Promote Bash calls that are still running after the configured delay."
                checked={bashAutoPromotion.enabled}
                onCheckedChange={setBashAutoPromotionEnabled}
              />
              <SettingsFieldRow
                id="tools-bash-auto-promotion-seconds"
                label="Background after"
                type="number"
                min={1}
                max={86_400}
                step={1}
                suffix="seconds"
                disabled={!bashAutoPromotion.enabled}
                class="max-w-xs"
                value={String(bashAutoPromotion.afterMs / 1000)}
                onValueChange={updateBashAutoPromotionSeconds}
              />
            </div>
          {:else if group.id === "web"}
            <SettingsSummaryRow
              class="mt-1"
              title={`${tavilyDisplayName} API key`}
              status={tavilyConfigured ? "ok" : "muted"}
            >
              {#snippet meta()}
                {tavilyConfigured
                  ? "•••••••• configured"
                  : "Required for web_search."}
              {/snippet}
              {#snippet actions()}
                <Button
                  size="xs"
                  variant="outline"
                  onclick={() => (tavilyDialogOpen = true)}
                  >{tavilyConfigured ? "Configure key" : "Add key"}</Button
                >
              {/snippet}
            </SettingsSummaryRow>
          {:else if group.id === "python"}
            <SettingsSummaryRow
              class="mt-1"
              title={python?.available
                ? "Runtime available"
                : "Runtime unavailable"}
              status={python?.available ? "ok" : "warning"}
            >
              {#snippet meta()}
                {#if python?.available}
                  {python.version ?? "Unknown version"} · {sourceLabel} ·
                  <span class="font-mono"
                    >{python.executable ?? "No executable"}</span
                  >
                {:else}
                  {python?.error ?? "No Python runtime was detected."}
                {/if}
              {/snippet}
              {#snippet actions()}
                <Button
                  size="xs"
                  variant="outline"
                  onclick={() => (pythonDialogOpen = true)}
                  >Configure runtime</Button
                >
              {/snippet}
            </SettingsSummaryRow>
            <SettingsInlineMessage
              tone="info"
              text="Planning-mode Python runs with file-write guardrails. This is not a hard security sandbox."
            />
          {/if}
        {/snippet}
      </SettingsDisclosureItem>
    {/each}
  </SettingsList>
</SettingsGroup>

<TavilyKeyDialog
  bind:open={tavilyDialogOpen}
  configured={tavilyConfigured}
  displayName={tavilyDisplayName}
/>

<PythonRuntimeDialog
  bind:open={pythonDialogOpen}
  {settingsDraft}
  {python}
  {onSettingsChange}
/>
