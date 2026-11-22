<script lang="ts">
import { Callout } from "@nervekit/ui-kit/components/composites/callout";
import ShieldCheck from "@lucide/svelte/icons/shield-check";
import type {
  AgentScope,
  GetAgentConfigurationResult,
} from "@nervekit/contracts/agent-configuration";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import Dialog from "@nervekit/ui-kit/components/composites/dialog-shell";
import ConfigurationRepairDialog from "./ConfigurationRepairDialog.svelte";
import { setProjectAgentTrust } from "./project-agent-trust";
let {
  document,
  scope,
  onReload,
  label = "Review configuration",
  variant = "ghost",
}: {
  document?: GetAgentConfigurationResult;
  scope?: AgentScope;
  onReload: () => void | Promise<void>;
  /** The button's label and look; the default is the quiet one used inside a callout. */
  label?: string;
  variant?: "ghost" | "outline";
} = $props();
let open = $state(false);
let repairOpen = $state(false);
let busy = $state(false);
let error = $state<string>();
const targetScope = $derived(
  scope ??
    (document?.status === "available" ? document.source.scope : undefined),
);
const available = $derived(
  document?.status === "available" ? document : undefined,
);
const replacement = $derived(
  available
    ? {
        schemaVersion: 1,
        revision: available.source.revision,
        overrides: available.overrides,
      }
    : { schemaVersion: 1, revision: 0, overrides: {} },
);
async function trust(trusted: boolean) {
  if (busy) return;
  busy = true;
  error = undefined;
  try {
    await setProjectAgentTrust(document, trusted);
    await onReload();
    open = false;
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  } finally {
    busy = false;
  }
}
</script>
<Button
  size="sm"
  {variant}
  class={variant === "ghost" ? "text-muted-foreground" : undefined}
  disabled={!targetScope}
  onclick={() => {
    error = undefined;
    open = true;
  }}
  >{#if variant === "ghost"}<ShieldCheck class="size-3.5" />{/if}{label}</Button
>
<Dialog
  {open}
  size="md"
  onOpenChange={(next) => {
    if (!busy) open = next;
  }}
  title="Project agent settings"
  description={available
    ? "Conversations in this project use these settings only while the file is trusted. Changes you make in Nerve stay trusted."
    : "The project settings file can't be loaded. Reload after fixing it, or preview a repair."}
>
  <div class="flex flex-col gap-2">
    {#if error}<Callout layout="block" tone="destructive" text={error} />{/if}
    {#if available}
      <p class="font-mono text-ui break-all text-muted-foreground">
        {available.source.path}
      </p>
      <pre
        class="max-h-64 overflow-auto rounded-md bg-well p-2 font-mono text-ui select-text">{JSON.stringify(
          available.overrides,
          null,
          2,
        )}</pre>
    {:else if document?.status === "unavailable"}
      <ul class="text-ui text-muted-foreground">
        {#each document.diagnostics as diagnostic, index (index)}<li
            class="font-mono break-all"
          >
            {diagnostic.code}: {diagnostic.path ||
              diagnostic.document}{diagnostic.pointer}
          </li>{/each}
      </ul>
    {/if}
  </div>
  {#snippet footer()}
    {#if available}
      <Button
        variant="ghost"
        disabled={busy}
        onclick={() => {
          open = false;
        }}>Cancel</Button
      >
      {#if available.source.digest !== "missing"}
        {#if available.trusted === false}
          <Button disabled={busy} onclick={() => trust(true)}>Trust file</Button
          >
        {:else}
          <Button variant="outline" disabled={busy} onclick={() => trust(false)}
            >Revoke trust</Button
          >
        {/if}
      {/if}
    {:else}
      <Button variant="outline" disabled={busy} onclick={onReload}
        >Reload</Button
      >
      <Button
        disabled={busy || !targetScope || targetScope.scope === "conversation"}
        onclick={() => {
          open = false;
          repairOpen = true;
        }}>Preview repair</Button
      >
    {/if}
  {/snippet}
</Dialog>
{#if targetScope}{#key JSON.stringify(targetScope)}<ConfigurationRepairDialog
      bind:open={repairOpen}
      target={{ document: "agent", scope: targetScope }}
      {replacement}
      onRepaired={onReload}
    />{/key}{/if}
