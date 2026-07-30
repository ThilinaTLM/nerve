<script lang="ts">
import Copy from "@lucide/svelte/icons/copy";
import type {
  CreatePromptSuggestionRequest,
  ProjectRecord,
  PromptSuggestionSourceKind,
  PromptSuggestionStatus,
} from "$lib/api";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Skeleton } from "@nervekit/ui-kit/components/ui/skeleton";
import { Switch } from "@nervekit/ui-kit/components/ui/switch";
import {
  SettingsDisclosureItem,
  SettingsEmptyState,
  SettingsGroup,
  SettingsInlineMessage,
  SettingsList,
  SettingsSearchInput,
  SettingsToolbar,
} from "$lib/presentation/components/settings";
import CreatePromptSuggestionDialog from "$lib/features/prompt-suggestions/components/CreatePromptSuggestionDialog.svelte";
import {
  createPromptSuggestion,
  refreshPromptSuggestionStatuses,
  setPromptSuggestionEnabled,
  setPromptSuggestionTrust,
} from "$lib/features/prompt-suggestions/state/prompt-suggestions-actions.svelte";
import { promptSuggestionsState } from "$lib/features/prompt-suggestions/state/prompt-suggestions-state.svelte";
import type { SuggestionsPageState } from "./suggestions-page-state.svelte";

type Props = {
  pageState: SuggestionsPageState;
  activeProject?: ProjectRecord;
};

let { pageState, activeProject }: Props = $props();

let savingKey = $state<string | undefined>(undefined);
let savingTrustId = $state<string | undefined>(undefined);
let mutationError = $state<string | undefined>(undefined);
let query = $state("");

const statuses = $derived(promptSuggestionsState.statuses);
const loading = $derived(
  promptSuggestionsState.loading && statuses.length === 0,
);
const builtins = $derived(sourceStatuses("builtin"));
const user = $derived(sourceStatuses("user"));
const project = $derived(sourceStatuses("project"));

$effect(() => {
  void refreshPromptSuggestionStatuses(activeProject?.id);
});

function sourceStatuses(
  source: PromptSuggestionSourceKind,
): PromptSuggestionStatus[] {
  const needle = query.trim().toLowerCase();
  return statuses
    .filter((status) => status.sourceKind === source)
    .filter(
      (status) =>
        !needle ||
        status.label.toLowerCase().includes(needle) ||
        status.name.toLowerCase().includes(needle) ||
        (status.description ?? "").toLowerCase().includes(needle),
    )
    .toSorted(
      (left, right) =>
        left.label.localeCompare(right.label) ||
        left.name.localeCompare(right.name),
    );
}

async function toggle(
  status: PromptSuggestionStatus,
  enabled: boolean,
): Promise<void> {
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
): Promise<void> {
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

async function create(request: CreatePromptSuggestionRequest): Promise<void> {
  await createPromptSuggestion(request, activeProject?.id);
}

function trustLabel(status: PromptSuggestionStatus): string {
  if (status.status === "not_required") return "No JS";
  return (
    status.status[0]?.toUpperCase() + status.status.slice(1).replace(/_/g, " ")
  );
}

function copyPath(path: string): void {
  void navigator.clipboard?.writeText(path);
}
</script>

{#snippet suggestionList(items: PromptSuggestionStatus[], emptyMessage: string)}
  {#if loading}
    <div class="grid gap-1.5">
      <Skeleton class="h-9 w-full" />
      <Skeleton class="h-9 w-full" />
      <Skeleton class="h-9 w-full" />
    </div>
  {:else if items.length === 0}
    <SettingsEmptyState title={emptyMessage} />
  {:else}
    <SettingsList>
      {#each items as status (status.definitionKey)}
        <SettingsDisclosureItem
          title={status.label}
          description={status.description}
        >
          {#snippet badges()}
            {#if status.overriddenBy}
              <Badge variant="secondary" size="xs">
                {status.overriddenBy === "project" ? "Project" : "User"} overrides
              </Badge>
            {/if}
            {#if status.requiresTrust}
              <Badge
                size="xs"
                tone={status.status === "allowed"
                  ? "good"
                  : status.status === "denied"
                    ? "danger"
                    : "neutral"}>{trustLabel(status)}</Badge
              >
            {/if}
          {/snippet}
          {#snippet actions()}
            {#if !status.stale}
              <Switch
                size="settings"
                checked={status.enabled}
                disabled={savingKey === status.definitionKey}
                aria-label={`Enable ${status.label} prompt suggestion`}
                onCheckedChange={(checked) => toggle(status, checked)}
              />
            {/if}
          {/snippet}
          {#snippet detail()}
            {#if status.description}
              <p>{status.description}</p>
            {/if}
            {#if status.sourceKind !== "builtin"}
              <div class="flex min-w-0 items-center gap-2">
                <span class="truncate font-mono" title={status.path}
                  >{status.path}</span
                >
                <Button
                  variant="ghost"
                  size="icon-sm"
                  ariaLabel="Copy suggestion path"
                  onclick={() => copyPath(status.path)}
                >
                  <Copy class="size-3.5" aria-hidden="true" />
                </Button>
              </div>
            {/if}
            {#if status.requiresTrust && status.trustId}
              <div class="flex flex-wrap gap-1">
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
          {/snippet}
        </SettingsDisclosureItem>
      {/each}
    </SettingsList>
  {/if}
{/snippet}

<SettingsToolbar>
  {#snippet start()}
    <SettingsSearchInput
      bind:value={query}
      placeholder="Search suggestions"
      ariaLabel="Search prompt suggestions"
      class="max-w-xs"
    />
  {/snippet}
</SettingsToolbar>

{#if promptSuggestionsState.error || mutationError}
  <SettingsInlineMessage
    tone="error"
    text={mutationError ?? promptSuggestionsState.error}
  >
    {#snippet actions()}
      <Button
        variant="outline"
        size="xs"
        onclick={() => refreshPromptSuggestionStatuses(activeProject?.id)}
        >Retry</Button
      >
    {/snippet}
  </SettingsInlineMessage>
{/if}

{#each promptSuggestionsState.diagnostics as diagnostic (`${diagnostic.path}:${diagnostic.code}:${diagnostic.message}`)}
  <SettingsInlineMessage tone="warning" text={diagnostic.message} />
{/each}

<SettingsGroup title="Built-in">
  {@render suggestionList(builtins, "No built-in suggestions are available.")}
</SettingsGroup>

<SettingsGroup title="User">
  {@render suggestionList(user, "No user suggestions have been created.")}
</SettingsGroup>

{#if activeProject}
  <SettingsGroup title={`Project · ${activeProject.name}`}>
    {@render suggestionList(
      project,
      "No suggestions have been created for this project.",
    )}
  </SettingsGroup>
{/if}

<CreatePromptSuggestionDialog
  bind:open={pageState.createDialogOpen}
  project={activeProject}
  onCreate={create}
/>
