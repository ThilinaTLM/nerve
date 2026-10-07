<script lang="ts">
import Info from "@lucide/svelte/icons/info";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import AgentSettingsDialog from "./AgentSettingsDialog.svelte";
import { controlAgent, ensureAgentView } from "../state/agent-selection.svelte";
import {
  saveAgentSettings,
  interruptAgentWithDraft,
  agentSettingsView,
} from "../state/agent-settings-actions";
import { pendingQueueItems } from "$lib/presentation/state/agent-queue-presentation";
import Popover, {
  PopoverBody,
  PopoverHeader,
  PopoverProperties,
  PopoverProperty,
  PopoverSection,
} from "@nervekit/ui-kit/components/composites/popover-panel";
import { statusTone } from "@nervekit/ui-kit/display/status";
import type { AgentActivitySnapshot, AgentRecord } from "$lib/api";
import {
  agentDetailFields,
  agentRoleLabel,
  agentStatusLabel,
} from "./context-agent-rows";

let {
  agent,
  activity,
  open = $bindable(false),
}: {
  agent: AgentRecord;
  activity?: AgentActivitySnapshot;
  open?: boolean;
} = $props();

const fields = $derived(agentDetailFields(agent));
const task = $derived(agent.task?.trim());
$effect(() => {
  ensureAgentView(agent);
});
const view = $derived(agentSettingsView(agent));
const pending = $derived(pendingQueueItems(view?.queuedPrompts ?? []));
let settingsOpen = $state(false);
</script>

<Popover
  bind:open
  size="md"
  side="bottom"
  align="end"
  collisionPadding={12}
  ariaLabel="Agent details"
  triggerTitle="Agent details"
  triggerClass="inline-flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
>
  {#snippet trigger()}
    <Info class="size-3.5" aria-hidden="true" />
  {/snippet}

  <PopoverHeader title={agentRoleLabel(agent)}>
    {#snippet actions()}
      <Badge variant={statusTone(activity?.state ?? "idle")}
        >{agentStatusLabel(activity)}</Badge
      >
    {/snippet}
  </PopoverHeader>

  <PopoverBody>
    {#if task}
      <PopoverSection label="Task">
        <p
          class="line-clamp-6 px-1.5 text-xs leading-relaxed whitespace-pre-wrap text-foreground"
          title={task}
        >
          {task}
        </p>
      </PopoverSection>
    {/if}
    <PopoverSection label="Configuration" separated={Boolean(task)}>
      <PopoverProperties>
        {#each fields as field (field.label)}
          <PopoverProperty
            label={field.label}
            value={field.value}
            title={field.title}
            valueClass={field.mono ? "font-mono" : undefined}
          />
        {/each}
        {#if (agent.configurationRevision ?? 1) > (agent.effectiveConfigurationRevision ?? 0)}
          <PopoverProperty
            label="Configuration state"
            value="Pending next turn"
          />
        {/if}
        {#if pending.length}
          <PopoverProperty
            label="Queue"
            value={`${pending.length} pending input`}
          />
        {/if}
      </PopoverProperties>
    </PopoverSection>
    {#if view}
      <PopoverSection label="Actions" separated>
        <div class="flex flex-wrap gap-2 px-1.5">
          <Button
            variant="outline"
            size="sm"
            disabled={view.stopping}
            onclick={() => {
              open = false;
              settingsOpen = true;
            }}>Agent settings</Button
          >
          <Button
            variant="outline"
            size="sm"
            disabled={view.stopping}
            onclick={() =>
              void controlAgent(
                agent,
                agent.activationState === "paused"
                  ? "agent.resume"
                  : "agent.stop",
              )}
            >{agent.activationState === "paused"
              ? "Resume agent"
              : "Pause agent"}</Button
          >
          <Button
            variant="outline"
            size="sm"
            disabled={view.stopping || !view.composerText.trim()}
            onclick={() => void interruptAgentWithDraft(agent)}
            >Interrupt and replace</Button
          >
        </div>
        {#if view.error}<p role="alert" class="px-1.5 text-xs text-destructive">
            {view.error}
          </p>{/if}
      </PopoverSection>
    {/if}
  </PopoverBody>
</Popover>
<AgentSettingsDialog
  {agent}
  bind:open={settingsOpen}
  latestCompletion={view?.latestCompletion}
  effectiveSnapshot={view?.effectiveConfiguration}
  onSave={(patch) => saveAgentSettings(agent, patch)}
/>
