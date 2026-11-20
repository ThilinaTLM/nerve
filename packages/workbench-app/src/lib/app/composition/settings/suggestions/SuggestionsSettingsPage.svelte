<script lang="ts">
import { Callout } from "@nervekit/ui-kit/components/composites/callout";
import type { ProjectRecord } from "$lib/presentation/view-models/conversation";
import Copy from "@lucide/svelte/icons/copy";
import type {
  CreatePromptSuggestionRequest,
  PromptSuggestionSourceKind,
  PromptSuggestionStatus,
} from "$lib/api";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import SearchInput from "@nervekit/ui-kit/components/composites/search-input";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Skeleton } from "@nervekit/ui-kit/components/ui/skeleton";
import { Switch } from "@nervekit/ui-kit/components/ui/switch";
import {
  SettingsEmptyState,
  SettingsItem,
  SettingsPageHeader,
  SettingsSection,
  SettingsList,
  SettingsToolbar,
} from "$lib/presentation/settings";
import CreatePromptSuggestionDialog from "$lib/features/prompt-suggestions/views/CreatePromptSuggestionDialog.svelte";
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
  /** The open suggestion's definition key; "" shows the list. */
  itemId?: string;
  onOpenItem?: (id: string) => void;
  /** Leaves the open suggestion for the list. */
  onCloseItem?: () => void;
};

let {
  pageState,
  activeProject,
  itemId = "",
  onOpenItem,
  onCloseItem,
}: Props = $props();

let savingKey = $state<string | undefined>(undefined);
let savingTrustId = $state<string | undefined>(undefined);
let mutationError = $state<string | undefined>(undefined);
let query = $state("");

const statuses = $derived(promptSuggestionsState.statuses);
const loading = $derived(
  promptSuggestionsState.loading && statuses.length === 0,
);
const open = $derived(
  itemId
    ? statuses.find((status) => status.definitionKey === itemId)
    : undefined,
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

{#snippet statusBadges(status: PromptSuggestionStatus)}
  {#if status.overriddenBy}
    <Badge variant="neutral">
      {status.overriddenBy === "project" ? "Project" : "User"} overrides
    </Badge>
  {/if}
  {#if status.requiresTrust}
    <Badge
      variant={status.status === "allowed"
        ? "success"
        : status.status === "denied"
          ? "destructive"
          : "neutral"}>{trustLabel(status)}</Badge
    >
  {/if}
{/snippet}

{#snippet detail(status: PromptSuggestionStatus)}
  <div class="flex flex-wrap items-center gap-2">
    {@render statusBadges(status)}
    <Badge variant="neutral"
      >{status.sourceKind === "builtin"
        ? "Built-in"
        : status.sourceKind === "project"
          ? "Project"
          : "User"}</Badge
    >
  </div>
  {#if status.conditionSummary}
    <SettingsSection title="Conditions">
      <p class="text-ui text-muted-foreground">{status.conditionSummary}</p>
    </SettingsSection>
  {/if}
  {#if status.promptPreview}
    <SettingsSection title="Prompt" surface={false}>
      <div
        class="rounded-md border bg-well px-2.5 py-2 text-ui whitespace-pre-wrap break-words text-foreground"
      >
        {status.promptPreview}
      </div>
    </SettingsSection>
  {/if}
  {#if status.sourceKind !== "builtin"}
    <div class="flex min-w-0 items-center gap-2 text-ui text-muted-foreground">
      <span class="truncate font-mono" title={status.path}>{status.path}</span>
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
        size="sm"
        variant="outline"
        disabled={savingTrustId === status.trustId}
        onclick={() => updateTrust(status.trustId, "allowed")}>Allow</Button
      >
      <Button
        size="sm"
        variant="destructive"
        disabled={savingTrustId === status.trustId}
        onclick={() => updateTrust(status.trustId, "denied")}>Deny</Button
      >
      <Button
        size="sm"
        variant="ghost"
        disabled={savingTrustId === status.trustId}
        onclick={() => updateTrust(status.trustId, "unset")}>Reset</Button
      >
    </div>
  {/if}
{/snippet}

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
        <SettingsItem
          title={status.label}
          summary={status.description}
          checked={status.stale ? undefined : status.enabled}
          disabled={savingKey === status.definitionKey}
          switchLabel={`Enable ${status.label} prompt suggestion`}
          onCheckedChange={(checked) => toggle(status, checked)}
          onOpen={() => onOpenItem?.(status.definitionKey)}
          openLabel={`Open ${status.label}`}
        >
          {#snippet badges()}
            {@render statusBadges(status)}
          {/snippet}
        </SettingsItem>
      {/each}
    </SettingsList>
  {/if}
{/snippet}

{#snippet notices()}
  {#if promptSuggestionsState.error || mutationError}
    <Callout
      layout="block"
      tone="destructive"
      text={mutationError ?? promptSuggestionsState.error}
    >
      {#snippet actions()}
        <Button
          variant="outline"
          size="sm"
          onclick={() => refreshPromptSuggestionStatuses(activeProject?.id)}
          >Retry</Button
        >
      {/snippet}
    </Callout>
  {/if}

  {#each promptSuggestionsState.diagnostics as diagnostic (`${diagnostic.path}:${diagnostic.code}:${diagnostic.message}`)}
    <Callout
      layout="block"
      tone={diagnostic.level === "error" ? "destructive" : "warning"}
      text={diagnostic.message}
    />
  {/each}
{/snippet}

{#if itemId}
  {#if onCloseItem}
    <!-- The detail's page header; the shell leaves this slot to it. -->
    <SettingsPageHeader
      title={open?.label ?? itemId}
      description={open?.description}
      parent={{ label: "Suggestions", onBack: onCloseItem }}
      class="mb-1"
    >
      {#snippet actions()}
        {#if open && !open.stale}
          <Switch
            checked={open.enabled}
            disabled={savingKey === open.definitionKey}
            aria-label={`Enable ${open.label} prompt suggestion`}
            onCheckedChange={(checked) => toggle(open, checked)}
          />
        {/if}
      {/snippet}
    </SettingsPageHeader>
  {/if}
  {@render notices()}
  {#if open}
    {@render detail(open)}
  {:else if loading}
    <Skeleton class="h-10 w-full" />
  {:else}
    <SettingsEmptyState
      variant="card"
      title="Suggestion not found"
      description={`No prompt suggestion is registered as “${itemId}”.`}
    />
  {/if}
{:else}
  <SettingsToolbar>
    {#snippet start()}
      <SearchInput
        bind:value={query}
        placeholder="Search suggestions"
        ariaLabel="Search prompt suggestions"
        class="max-w-xs"
      />
    {/snippet}
  </SettingsToolbar>

  {@render notices()}

  <SettingsSection id="suggestions" title="Built-in">
    {@render suggestionList(builtins, "No built-in suggestions are available.")}
  </SettingsSection>

  <SettingsSection title="User">
    {@render suggestionList(user, "No user suggestions have been created.")}
  </SettingsSection>

  {#if activeProject}
    <SettingsSection title={`Project · ${activeProject.name}`}>
      {@render suggestionList(
        project,
        "No suggestions have been created for this project.",
      )}
    </SettingsSection>
  {/if}
{/if}

<CreatePromptSuggestionDialog
  bind:open={pageState.createDialogOpen}
  project={activeProject}
  onCreate={create}
/>
