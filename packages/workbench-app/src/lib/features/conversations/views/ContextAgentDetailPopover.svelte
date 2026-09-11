<script lang="ts">
import Info from "@lucide/svelte/icons/info";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import Popover, {
  PopoverBody,
  PopoverHeader,
  PopoverProperties,
  PopoverProperty,
  PopoverSection,
} from "@nervekit/ui-kit/components/composites/popover-panel";
import { statusTone } from "@nervekit/ui-kit/display/status";
import type { AgentRecord } from "$lib/api";
import {
  agentDetailFields,
  agentRoleLabel,
  agentStatusLabel,
} from "./context-agent-rows";

let {
  agent,
  open = $bindable(false),
}: {
  agent: AgentRecord;
  open?: boolean;
} = $props();

const fields = $derived(agentDetailFields(agent));
const task = $derived(agent.task?.trim());
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
      <Badge variant={statusTone(agent.status)}>{agentStatusLabel(agent)}</Badge
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
      </PopoverProperties>
    </PopoverSection>
  </PopoverBody>
</Popover>
