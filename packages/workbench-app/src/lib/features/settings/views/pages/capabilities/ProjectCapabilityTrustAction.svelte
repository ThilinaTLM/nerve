<!--
  Review configuration: what is wrong with an `agent.json` that can't be
  loaded, with Reload and Preview repair. Trust decisions are made in the
  shared review dialog, not here.
-->
<script lang="ts">
import ShieldCheck from "@lucide/svelte/icons/shield-check";
import type {
  AgentScope,
  GetAgentConfigurationResult,
} from "@nervekit/contracts/agent-configuration";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import Dialog from "@nervekit/ui-kit/components/composites/dialog-shell";
import ConfigurationRepairDialog from "./ConfigurationRepairDialog.svelte";
let {
  document,
  scope,
  onReload,
}: {
  document?: GetAgentConfigurationResult;
  scope?: AgentScope;
  onReload: () => void | Promise<void>;
} = $props();
let open = $state(false);
let repairOpen = $state(false);
const targetScope = $derived(
  scope ??
    (document?.status === "available" ? document.source.scope : undefined),
);
const replacement = $derived(
  document?.status === "available"
    ? {
        schemaVersion: 1,
        revision: document.source.revision,
        overrides: document.overrides,
      }
    : { schemaVersion: 1, revision: 0, overrides: {} },
);
</script>

<Button
  size="sm"
  variant="ghost"
  class="text-muted-foreground"
  disabled={!targetScope}
  onclick={() => (open = true)}
  ><ShieldCheck class="size-3.5" />Review configuration</Button
>
<Dialog
  bind:open
  size="md"
  title="Agent settings file"
  description="The settings file can't be loaded. Reload after fixing it, or preview a repair."
>
  {#if document?.status === "unavailable"}
    <ul class="text-ui text-muted-foreground">
      {#each document.diagnostics as diagnostic, index (index)}<li
          class="font-mono break-all"
        >
          {diagnostic.code}: {diagnostic.path ||
            diagnostic.document}{diagnostic.pointer}
        </li>{/each}
    </ul>
  {/if}
  {#snippet footer()}
    <Button variant="outline" onclick={onReload}>Reload</Button>
    <Button
      disabled={!targetScope || targetScope.scope === "conversation"}
      onclick={() => {
        open = false;
        repairOpen = true;
      }}>Preview repair</Button
    >
  {/snippet}
</Dialog>
{#if targetScope}{#key JSON.stringify(targetScope)}<ConfigurationRepairDialog
      bind:open={repairOpen}
      target={{ document: "agent", scope: targetScope }}
      {replacement}
      onRepaired={onReload}
    />{/key}{/if}
