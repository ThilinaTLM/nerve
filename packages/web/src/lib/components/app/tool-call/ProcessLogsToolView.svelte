<script lang="ts">
  import type { ToolCallRecord } from "../../../api";
  import type { ToolView } from "../../../tool-views/tool-result-view";
  import Disclosure from "./Disclosure.svelte";
  import LogLineList from "./LogLineList.svelte";

  type Props = { toolCall: ToolCallRecord; view: Extract<ToolView, { kind: "process_logs" }> };
  let { view }: Props = $props();
</script>

{#if view.events.length === 0}
  <p class="note">No log events.</p>
{:else}
  <LogLineList events={view.tailEvents} />
  {#if view.events.length > view.tailEvents.length}
    <Disclosure label={`all ${view.events.length} events`}>
      <LogLineList events={view.events} maxHeight="26rem" />
    </Disclosure>
  {/if}
{/if}

<style>
  .note {
    margin: 0;
    font-size: 0.6875rem;
    color: var(--muted-foreground);
  }
</style>
