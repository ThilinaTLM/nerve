<script lang="ts">
import { Callout } from "@nervekit/ui-kit/components/composites/callout";
import ShieldCheck from "@lucide/svelte/icons/shield-check";
import type {
  AgentScope,
  GetAgentConfigurationResult,
} from "@nervekit/contracts/agent-configuration";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Textarea } from "@nervekit/ui-kit/components/ui/textarea";
import Dialog from "@nervekit/ui-kit/components/composites/dialog-shell";
import { EntityRow } from "$lib/presentation/settings";
import { requestWorkbench } from "$lib/application/startup/workbench-connection";
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
let busy = $state(false);
let error = $state<string>();
let message = $state<string>();
let messageDigest = $state<string>();
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
async function trust(trusted: boolean) {
  const target = targetScope;
  if (busy || document?.status !== "available" || target?.scope !== "project")
    return;
  const expectedDigest = document.source.digest;
  busy = true;
  error = undefined;
  message = undefined;
  try {
    const result = await requestWorkbench("agentConfiguration.trust", {
      target: { document: "agent", scope: target },
      expectedDigest,
      trusted,
    });
    if (result.status !== "saved")
      error = `Trust ${result.status}. Reload and review the current bytes.`;
    else {
      messageDigest = result.digest;
      message = result.trusted
        ? "Trust granted for the reviewed digest."
        : "Trust revoked.";
      await onReload();
    }
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  } finally {
    busy = false;
  }
}
</script>
<Button
  size="sm"
  variant="ghost"
  class="text-muted-foreground"
  disabled={!targetScope}
  onclick={() => {
    error = undefined;
    message = undefined;
    open = true;
  }}><ShieldCheck class="size-3.5" />Review configuration</Button
>
<Dialog
  {open}
  onOpenChange={(next) => {
    if (!busy) open = next;
  }}
  title="Review configuration"
  description="Trust is bound to the exact reviewed bytes. Dismissing this dialog does not trust, reset or repair the document."
>
  {#if error}<Callout layout="block" tone="destructive" text={error} />{/if}
  {#if message && document?.status === "available" && document.source.digest === messageDigest}<Callout
      layout="block"
      tone="success"
      text={message}
    />{/if}
  {#if document?.status === "available"}
    <EntityRow label="Path" value={document.source.path} />
    <EntityRow label="Revision" value={String(document.source.revision)} />
    <EntityRow label="Digest" value={document.source.digest} />
    <Textarea
      readonly
      class="font-mono"
      rows={8}
      aria-label="Reviewed scoped configuration"
      value={JSON.stringify(replacement, null, 2)}
    />
  {:else if document}
    {#each document.diagnostics as diagnostic, index (index)}<EntityRow
        label={diagnostic.code}
        value={`${diagnostic.path || diagnostic.document}${diagnostic.pointer}`}
      />{/each}
  {/if}
  {#snippet footer()}
    <Button
      variant="ghost"
      disabled={busy}
      onclick={() => {
        open = false;
      }}>Dismiss</Button
    >
    <Button variant="outline" disabled={busy} onclick={onReload}>Reload</Button>
    <Button
      variant="outline"
      disabled={busy || !targetScope || targetScope.scope === "conversation"}
      onclick={() => {
        open = false;
        repairOpen = true;
      }}>Preview repair</Button
    >
    {#if targetScope?.scope === "project" && document?.status === "available" && document.source.digest !== "missing"}
      <Button variant="outline" disabled={busy} onclick={() => trust(false)}
        >Revoke trust</Button
      ><Button disabled={busy} onclick={() => trust(true)}>Trust file</Button>
    {/if}
  {/snippet}
</Dialog>
{#if targetScope}{#key JSON.stringify(targetScope)}<ConfigurationRepairDialog
      bind:open={repairOpen}
      target={{ document: "agent", scope: targetScope }}
      {replacement}
      onRepaired={onReload}
    />{/key}{/if}
