<script lang="ts">
  import { onMount } from "svelte";
  import { Badge } from "@nervekit/ui/components/ui/badge";
  import { Button } from "@nervekit/ui/components/ui/button";
  import { selection } from "$lib/features/workspace/state/selection.svelte";
  import SettingsSectionCard from "../SettingsSectionCard.svelte";
  import { promptSuggestionsState } from "$lib/features/prompt-suggestions/state/prompt-suggestions-state.svelte";
  import {
    refreshPromptSuggestionStatuses,
    setPromptSuggestionTrust,
  } from "$lib/features/prompt-suggestions/state/prompt-suggestions-actions.svelte";

  let savingTrustId = $state<string | undefined>(undefined);
  const statuses = $derived(promptSuggestionsState.statuses);

  onMount(() => {
    void refreshPromptSuggestionStatuses(selection.projectId);
  });

  async function update(trustId: string | undefined, status: "allowed" | "denied" | "unset") {
    if (!trustId) return;
    savingTrustId = trustId;
    try {
      await setPromptSuggestionTrust({ trustId, status });
      await refreshPromptSuggestionStatuses(selection.projectId);
    } finally {
      savingTrustId = undefined;
    }
  }

  function labelForStatus(status: string): string {
    if (status === "not_required") return "No JS";
    return status[0]?.toUpperCase() + status.slice(1).replace(/_/g, " ");
  }
</script>

<SettingsSectionCard
  section="prompt-suggestions"
  title="Prompt suggestions"
  description="Review local Markdown suggestions and JavaScript enable predicates."
>
    <p class="settings-note">JavaScript trust is tied to the predicate content hash. Editing the predicate requires approval again.</p>

    {#if statuses.length === 0}
      <p class="text-sm text-muted-foreground">No prompt suggestions found for the current project or user suggestions directory.</p>
    {:else}
      <div class="grid gap-2">
        {#each statuses as status (status.trustId ?? `${status.sourceKind}:${status.path}:${status.name}`)}
          <section class="grid gap-2 rounded-md border border-border bg-card p-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <strong class="text-sm font-medium text-foreground">{status.label}</strong>
                  <Badge variant={status.status === "allowed" ? "default" : status.status === "denied" ? "destructive" : "secondary"}>{labelForStatus(status.status)}</Badge>
                  <span class="text-xs text-muted-foreground">{status.sourceKind}</span>
                </div>
                <p class="font-mono text-xs text-muted-foreground">{status.path}</p>
              </div>
              {#if status.requiresTrust && status.trustId}
                <div class="flex flex-wrap gap-1">
                  <Button size="xs" variant="outline" disabled={savingTrustId === status.trustId} onclick={() => update(status.trustId, "allowed")}>Allow</Button>
                  <Button size="xs" variant="destructive" disabled={savingTrustId === status.trustId} onclick={() => update(status.trustId, "denied")}>Deny</Button>
                  <Button size="xs" variant="ghost" disabled={savingTrustId === status.trustId} onclick={() => update(status.trustId, "unset")}>Reset</Button>
                </div>
              {/if}
            </div>
            {#if status.description}
              <p class="text-xs text-muted-foreground">{status.description}</p>
            {/if}
          </section>
        {/each}
      </div>
    {/if}
</SettingsSectionCard>
