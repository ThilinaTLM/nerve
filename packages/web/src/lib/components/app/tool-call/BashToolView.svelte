<script lang="ts">
  import { Badge } from "../../ui/badge";
  import type { ToolCallRecord } from "../../../api";
  import type { ToolView } from "../../../tool-views/tool-result-view";
  import Disclosure from "./Disclosure.svelte";
  import LogLineList from "./LogLineList.svelte";

  type Props = { toolCall: ToolCallRecord; view: Extract<ToolView, { kind: "bash" }> };
  let { view }: Props = $props();
</script>

<div class="badges">
  {#if view.exitCode !== undefined}
    <Badge tone={view.exitCode === 0 ? "good" : "danger"} size="xs">exit {view.exitCode}</Badge>
  {/if}
  {#if view.signal}
    <Badge tone="warn" size="xs">signal {view.signal}</Badge>
  {/if}
</div>

{#if view.tailLines.length > 0}
  <LogLineList lines={view.tailLines} />
{/if}

{#if view.savedTo}
  <p class="note">Full output saved to <span class="path">{view.savedTo}</span></p>
{/if}

{#if view.stdout && view.stdout.length > 0}
  <Disclosure label="stdout">
    <LogLineList lines={view.stdout.split("\n")} maxHeight="24rem" />
  </Disclosure>
{/if}
{#if view.stderr && view.stderr.length > 0}
  <Disclosure label="stderr">
    <LogLineList lines={view.stderr.split("\n")} maxHeight="24rem" />
  </Disclosure>
{/if}

<style>
  .badges {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }

  .badges:empty {
    display: none;
  }

  .note {
    margin: 0;
    font-size: 0.6875rem;
    color: var(--muted-foreground);
  }

  .path {
    font-family: var(--font-mono);
  }
</style>
