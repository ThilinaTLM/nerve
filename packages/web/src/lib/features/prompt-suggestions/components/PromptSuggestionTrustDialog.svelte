<script lang="ts">
  import AlertTriangle from "@lucide/svelte/icons/alert-triangle";
  import { Button } from "$lib/components/ui/button";
  import DialogShell from "$lib/components/ui/dialog-shell";
  import { promptSuggestionsState } from "$lib/features/prompt-suggestions/state/prompt-suggestions-state.svelte";
  import {
    dismissPromptSuggestionTrustRequest,
    refreshPromptSuggestions,
    setPromptSuggestionTrust,
  } from "$lib/features/prompt-suggestions/state/prompt-suggestions-actions.svelte";

  type Props = {
    projectId?: string;
    conversationId?: string;
    agentId?: string;
  };

  let { projectId, conversationId, agentId }: Props = $props();
  let saving = $state(false);
  const requests = $derived(promptSuggestionsState.trustRequests);
  const open = $derived(requests.length > 0);

  async function apply(status: "allowed" | "denied") {
    saving = true;
    try {
      for (const request of requests) {
        await setPromptSuggestionTrust({ trustId: request.trustId, status });
      }
      if (projectId) await refreshPromptSuggestions(projectId, { conversationId, agentId });
    } finally {
      saving = false;
    }
  }

  function decideLater() {
    for (const request of requests) dismissPromptSuggestionTrustRequest(request.trustId);
  }
</script>

<DialogShell
  {open}
  title="Allow prompt suggestion JavaScript?"
  description="Some prompt suggestions include JavaScript that decides when the suggestion appears."
  class="max-w-2xl"
  onOpenChange={(next) => {
    if (!next) decideLater();
  }}
>
  <div class="grid gap-4 p-4">
    <div class="flex gap-3 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
      <AlertTriangle class="mt-0.5 size-4 flex-none text-warning" strokeWidth={2.2} />
      <p class="text-muted-foreground">
        Only allow JavaScript from suggestion files you trust. Nerve runs it locally in the daemon with a limited context and timeout, but it is still local code from the listed Markdown file.
      </p>
    </div>

    <div class="grid gap-2">
      {#each requests as request (request.trustId)}
        <section class="grid gap-1 rounded-md border border-border bg-card p-3">
          <div class="flex items-center justify-between gap-3">
            <strong class="text-sm font-medium text-foreground">{request.label}</strong>
            <span class="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">{request.sourceKind}</span>
          </div>
          <p class="font-mono text-xs text-muted-foreground">{request.path}</p>
          {#if request.description}
            <p class="text-xs text-muted-foreground">{request.description}</p>
          {/if}
        </section>
      {/each}
    </div>
  </div>

  {#snippet footer()}
    <Button variant="ghost" disabled={saving} onclick={decideLater}>Decide later</Button>
    <Button variant="destructive" disabled={saving} onclick={() => apply("denied")}>Deny</Button>
    <Button disabled={saving} onclick={() => apply("allowed")}>Allow</Button>
  {/snippet}
</DialogShell>
