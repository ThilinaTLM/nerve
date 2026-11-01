<script lang="ts">
import { Callout } from "@nervekit/ui-kit/components/composites/callout";
import AlertTriangle from "@lucide/svelte/icons/alert-triangle";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import DialogShell from "@nervekit/ui-kit/components/composites/dialog-shell";
import { promptSuggestionsState } from "$lib/features/prompt-suggestions/state/prompt-suggestions-state.svelte";
import {
  dismissPromptSuggestionTrustRequest,
  refreshPromptSuggestions,
  setPromptSuggestionTrust,
} from "$lib/features/prompt-suggestions/state/prompt-suggestions-actions.svelte";

type Props = {
  projectId?: string;
  conversationId?: string;
};

let { projectId, conversationId }: Props = $props();
let saving = $state(false);
const requests = $derived(promptSuggestionsState.trustRequests);
const open = $derived(requests.length > 0);

async function apply(status: "allowed" | "denied") {
  saving = true;
  try {
    for (const request of requests) {
      await setPromptSuggestionTrust({ trustId: request.trustId, status });
    }
    if (projectId)
      await refreshPromptSuggestions(projectId, { conversationId });
  } finally {
    saving = false;
  }
}

function decideLater() {
  for (const request of requests)
    dismissPromptSuggestionTrustRequest(request.trustId);
}
</script>

<DialogShell
  {open}
  title="Allow prompt suggestion JavaScript?"
  description="Some prompt suggestions include JavaScript that decides when the suggestion appears."
  size="md"
  onOpenChange={(next) => {
    if (!next) decideLater();
  }}
>
  <div class="grid gap-4">
    <Callout layout="block" tone="warning" icon={AlertTriangle}>
      <p class="text-muted-foreground">
        Only allow JavaScript from suggestion files you trust. Nerve runs it
        locally in the daemon with a limited context and timeout, but it is
        still local code from the listed Markdown file.
      </p>
    </Callout>

    <div class="grid gap-2">
      {#each requests as request (request.trustId)}
        <section
          class="grid gap-1 rounded-md border border-border bg-transparent p-3"
        >
          <div class="flex items-center justify-between gap-3">
            <strong class="text-ui font-normal text-foreground"
              >{request.label}</strong
            >
            <Badge>{request.sourceKind}</Badge>
          </div>
          <p class="font-mono text-ui text-muted-foreground">{request.path}</p>
          {#if request.description}
            <p class="text-ui text-muted-foreground">{request.description}</p>
          {/if}
        </section>
      {/each}
    </div>
  </div>

  {#snippet footer()}
    <Button variant="ghost" disabled={saving} onclick={decideLater}
      >Decide later</Button
    >
    <Button
      variant="destructive"
      disabled={saving}
      onclick={() => apply("denied")}>Deny</Button
    >
    <Button disabled={saving} onclick={() => apply("allowed")}>Allow</Button>
  {/snippet}
</DialogShell>
