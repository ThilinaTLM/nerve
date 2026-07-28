<script lang="ts">
import Plus from "@lucide/svelte/icons/plus";
import type {
  CreatePromptSuggestionRequest,
  ProjectRecord,
  PromptSuggestionSourceKind,
  PromptSuggestionStatus,
} from "$lib/api";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import { Switch as ToggleSwitch } from "@nervekit/ui-kit/components/ui/switch";
import { SettingsSectionCard } from "$lib/presentation/components/settings";
import CreatePromptSuggestionDialog from "$lib/features/prompt-suggestions/components/CreatePromptSuggestionDialog.svelte";
import {
  createPromptSuggestion,
  refreshPromptSuggestionStatuses,
  setPromptSuggestionEnabled,
  setPromptSuggestionTrust,
} from "$lib/features/prompt-suggestions/state/prompt-suggestions-actions.svelte";
import { promptSuggestionsState } from "$lib/features/prompt-suggestions/state/prompt-suggestions-state.svelte";

type Props = { activeProject?: ProjectRecord };
let { activeProject }: Props = $props();

let savingKey = $state<string | undefined>(undefined);
let savingTrustId = $state<string | undefined>(undefined);
let createOpen = $state(false);
let mutationError = $state<string | undefined>(undefined);

const statuses = $derived(promptSuggestionsState.statuses);
const builtins = $derived(sourceStatuses("builtin"));
const user = $derived(sourceStatuses("user"));
const project = $derived(sourceStatuses("project"));

$effect(() => {
  void refreshPromptSuggestionStatuses(activeProject?.id);
});

function sourceStatuses(source: PromptSuggestionSourceKind) {
  return statuses
    .filter((status) => status.sourceKind === source)
    .toSorted(
      (left, right) =>
        left.label.localeCompare(right.label) ||
        left.name.localeCompare(right.name),
    );
}

async function toggle(status: PromptSuggestionStatus, enabled: boolean) {
  savingKey = status.definitionKey;
  mutationError = undefined;
  try {
    await setPromptSuggestionEnabled(
      { definitionKey: status.definitionKey, enabled },
      activeProject?.id,
    );
  } catch (error) {
    mutationError = error instanceof Error ? error.message : String(error);
    await refreshPromptSuggestionStatuses(activeProject?.id);
  } finally {
    savingKey = undefined;
  }
}

async function updateTrust(
  trustId: string | undefined,
  status: "allowed" | "denied" | "unset",
) {
  if (!trustId) return;
  savingTrustId = trustId;
  mutationError = undefined;
  try {
    await setPromptSuggestionTrust({ trustId, status });
    await refreshPromptSuggestionStatuses(activeProject?.id);
  } catch (error) {
    mutationError = error instanceof Error ? error.message : String(error);
  } finally {
    savingTrustId = undefined;
  }
}

async function create(request: CreatePromptSuggestionRequest) {
  await createPromptSuggestion(request, activeProject?.id);
}

function trustLabel(status: PromptSuggestionStatus): string {
  if (status.status === "not_required") return "No JS";
  return (
    status.status[0]?.toUpperCase() + status.status.slice(1).replace(/_/g, " ")
  );
}
</script>

{#snippet suggestionList(items: PromptSuggestionStatus[], emptyMessage: string)}
  {#if promptSuggestionsState.loading && statuses.length === 0}
    <div class="flex items-center gap-2 py-3 text-sm text-muted-foreground">
      <Spinner class="size-4" />
      <span>Loading prompt suggestions…</span>
    </div>
  {:else if items.length === 0}
    <p class="py-3 text-sm text-muted-foreground">{emptyMessage}</p>
  {:else}
    <div class="divide-y divide-border">
      {#each items as status (status.definitionKey)}
        <div
          class="flex items-start justify-between gap-4 py-4 first:pt-1 last:pb-1"
        >
          <div class="min-w-0 space-y-1">
            <div class="flex flex-wrap items-center gap-2">
              <h3 class="text-sm font-medium text-foreground">
                {status.label}
              </h3>
              {#if status.overriddenBy}
                <Badge variant="secondary">
                  {status.overriddenBy === "project" ? "Project" : "User"} overrides
                </Badge>
              {/if}
              {#if status.requiresTrust}
                <Badge
                  variant={status.status === "allowed"
                    ? "default"
                    : status.status === "denied"
                      ? "destructive"
                      : "secondary"}>{trustLabel(status)}</Badge
                >
              {/if}
            </div>
            {#if status.description}
              <p class="text-sm text-muted-foreground">{status.description}</p>
            {/if}
            {#if status.sourceKind !== "builtin"}
              <p
                class="break-all font-mono text-xs text-muted-foreground"
                title={status.path}
              >
                {status.path}
              </p>
            {/if}
            {#if status.requiresTrust && status.trustId}
              <div class="flex flex-wrap gap-1 pt-1">
                <Button
                  size="xs"
                  variant="outline"
                  disabled={savingTrustId === status.trustId}
                  onclick={() => updateTrust(status.trustId, "allowed")}
                  >Allow</Button
                >
                <Button
                  size="xs"
                  variant="destructive"
                  disabled={savingTrustId === status.trustId}
                  onclick={() => updateTrust(status.trustId, "denied")}
                  >Deny</Button
                >
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={savingTrustId === status.trustId}
                  onclick={() => updateTrust(status.trustId, "unset")}
                  >Reset</Button
                >
              </div>
            {/if}
          </div>
          {#if !status.stale}
            <ToggleSwitch
              size="settings"
              checked={status.enabled}
              disabled={savingKey === status.definitionKey}
              aria-label={`Enable ${status.label} prompt suggestion`}
              onCheckedChange={(checked) => toggle(status, checked)}
            />
          {/if}
        </div>
      {/each}
    </div>
  {/if}
{/snippet}

<SettingsSectionCard
  section="prompt-suggestions"
  title="Prompt suggestions"
  description="Choose which suggestions appear in the composer or create your own reusable prompts."
>
  <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
    <p class="text-sm text-muted-foreground">
      Project suggestions override user and built-in suggestions with the same
      name.
    </p>
    <Button size="sm" onclick={() => (createOpen = true)}>
      <Plus class="size-4" />
      New suggestion
    </Button>
  </div>

  {#if promptSuggestionsState.error || mutationError}
    <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
      <p class="text-sm text-destructive">
        {mutationError ?? promptSuggestionsState.error}
      </p>
      <Button
        variant="outline"
        size="sm"
        onclick={() => refreshPromptSuggestionStatuses(activeProject?.id)}
        >Retry</Button
      >
    </div>
  {/if}

  {#if promptSuggestionsState.diagnostics.length > 0}
    <div class="mb-4 rounded-md border border-warning/40 bg-warning/10 p-3">
      {#each promptSuggestionsState.diagnostics as diagnostic (`${diagnostic.path}:${diagnostic.code}:${diagnostic.message}`)}
        <p class="text-xs text-warning">{diagnostic.message}</p>
      {/each}
    </div>
  {/if}

  <div class="grid gap-6">
    <section>
      <h2 class="mb-3 text-sm font-medium text-foreground">Built-in</h2>
      {@render suggestionList(
        builtins,
        "No built-in suggestions are available.",
      )}
    </section>
    <section>
      <h2 class="mb-3 text-sm font-medium text-foreground">User</h2>
      {@render suggestionList(user, "No user suggestions have been created.")}
    </section>
    {#if activeProject}
      <section>
        <h2 class="mb-3 text-sm font-medium text-foreground">
          Project · {activeProject.name}
        </h2>
        {@render suggestionList(
          project,
          "No suggestions have been created for this project.",
        )}
      </section>
    {/if}
  </div>
</SettingsSectionCard>

<CreatePromptSuggestionDialog
  bind:open={createOpen}
  project={activeProject}
  onCreate={create}
/>
