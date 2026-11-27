<script lang="ts">
import { matchesTerms } from "@nervekit/ui-kit/collections/match-terms";
import {
  PageEmptyState,
  PageHeader,
  PageItem,
} from "@nervekit/ui-kit/components/composites/page";
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
import Lightbulb from "@lucide/svelte/icons/lightbulb";
import {
  LayerEnabledTable,
  LayerSwitches,
  OriginGroup,
  SETTINGS_SEARCH_MIN,
  SettingsSection,
  TipBadge,
  type SettingsLayer,
  type SettingsOrigin,
} from "$lib/presentation/settings";
import ConfigurationReviewCallout from "$lib/presentation/configuration-review/ConfigurationReviewCallout.svelte";
import type { ConfigurationReviewTarget } from "@nervekit/contracts/configuration";
import { openConfigurationReview } from "$lib/application/configuration-review/configuration-review-queue.svelte";
import ItemReviewSections from "$lib/features/settings/views/pages/review/ItemReviewSections.svelte";
import { useItemReview } from "$lib/features/settings/views/pages/review/item-review.svelte";
import CreatePromptSuggestionDialog from "$lib/features/prompt-suggestions/views/CreatePromptSuggestionDialog.svelte";
import { trustPromptSuggestionProjectFile } from "$lib/features/prompt-suggestions/api/prompt-suggestions.api";
import {
  createPromptSuggestion,
  refreshPromptSuggestionStatuses,
  setPromptSuggestionLayers,
} from "$lib/features/prompt-suggestions/state/prompt-suggestions-actions.svelte";
import { promptSuggestionsState } from "$lib/features/prompt-suggestions/state/prompt-suggestions-state.svelte";
import type { SuggestionsPageState } from "./suggestions-page-state.svelte";
import {
  awaitsReview,
  suggestionTrustState,
  suggestionSwitches,
  suggestionWrites,
  trustBadge,
} from "./suggestions-view";

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
const projectName = $derived(activeProject?.name);
const projectFile = $derived(
  activeProject ? promptSuggestionsState.projectFile : undefined,
);
/** The decision on the project's enablement file, when it has one to make. */
const fileState = $derived(
  projectFile?.status === "needs_review" ||
    projectFile?.status === "declined" ||
    projectFile?.status === "trusted"
    ? projectFile.status
    : undefined,
);
/** The project's enablement file is not trusted: the daemon ignores it, so its column is locked. */
const locked = $derived(
  fileState === "needs_review" || fileState === "declined",
);
let decidingFile = $state(false);
async function decideFile(trusted: boolean): Promise<void> {
  const projectId = activeProject?.id;
  const digest = projectFile?.digest;
  if (!projectId || !digest || decidingFile) return;
  decidingFile = true;
  mutationError = undefined;
  try {
    const status = await trustPromptSuggestionProjectFile({
      projectId,
      expectedDigest: digest,
      trusted,
    });
    if (status === "conflict")
      mutationError =
        "The project's suggestion settings file changed. Review it again.";
  } catch (error) {
    mutationError = error instanceof Error ? error.message : String(error);
  } finally {
    decidingFile = false;
    await refreshPromptSuggestionStatuses(projectId);
  }
}
$effect(() => {
  pageState.projectName = projectName;
  return () => {
    pageState.projectName = undefined;
  };
});
const groups = $derived(
  (
    [
      ...(activeProject ? (["project"] as const) : []),
      "user",
      "builtin",
    ] as const
  ).map((source) => ({
    source,
    origin: { kind: source } satisfies SettingsOrigin,
    rows: sourceStatuses(source),
  })),
);
const emptyCopy = {
  project: "No suggestions have been created for this project.",
  user: "No user suggestions have been created.",
  builtin: "",
};

$effect(() => {
  void refreshPromptSuggestionStatuses(activeProject?.id);
});

function sourceStatuses(
  source: PromptSuggestionSourceKind,
): PromptSuggestionStatus[] {
  return statuses
    .filter((status) => status.sourceKind === source)
    .filter((status) =>
      matchesTerms(query, status.label, status.name, status.description),
    )
    .toSorted(
      (left, right) =>
        left.label.localeCompare(right.label) ||
        left.name.localeCompare(right.name),
    );
}

async function change(
  status: PromptSuggestionStatus,
  layer: SettingsLayer,
  next: boolean,
): Promise<void> {
  mutationError = undefined;
  try {
    await setPromptSuggestionLayers(
      await suggestionWrites(status, layer, next, activeProject?.id),
      activeProject?.id,
    );
  } catch (error) {
    mutationError = error instanceof Error ? error.message : String(error);
    await refreshPromptSuggestionStatuses(activeProject?.id);
  }
}

/** The review dialog's target for a user or project suggestion. */
function reviewTarget(
  status: PromptSuggestionStatus,
): ConfigurationReviewTarget | undefined {
  if (status.sourceKind === "user")
    return { kind: "prompt-suggestion", scope: "user", id: status.name };
  if (status.sourceKind === "project" && activeProject)
    return {
      kind: "prompt-suggestion",
      scope: "project",
      projectId: activeProject.id,
      id: status.name,
    };
  return undefined;
}
/** Review and Trust open the shared review dialog; a built-in opens its page. */
function review(status: PromptSuggestionStatus): void {
  const target = reviewTarget(status);
  if (target) openConfigurationReview([target]);
  else onOpenItem?.(status.definitionKey);
}
const openReview = useItemReview(() => (open ? reviewTarget(open) : undefined));

async function create(request: CreatePromptSuggestionRequest): Promise<void> {
  await createPromptSuggestion(request, activeProject?.id);
}

function copyPath(path: string): void {
  void navigator.clipboard?.writeText(path);
}
</script>

{#snippet statusBadges(status: PromptSuggestionStatus)}
  {#if status.overriddenBy}
    <TipBadge
      text={status.overriddenBy === "project"
        ? "Replaced in project"
        : "Replaced by your copy"}
      tip="A suggestion with the same name is used instead of this one."
    />
  {/if}
  {@const badge = trustBadge(status)}
  <TipBadge text={badge.text} tip={badge.tip} variant={badge.variant} />
{/snippet}

{#snippet switches(status: PromptSuggestionStatus)}
  {@const values = suggestionSwitches(status)}
  <LayerSwitches
    name={`${status.label} prompt suggestion`}
    user={values.user}
    project={values.project}
    projectSet={values.projectSet}
    {projectName}
    projectOnly={status.sourceKind === "project"}
    pending={awaitsReview(status)}
    {locked}
    inapplicable={status.overriddenBy === "project" &&
      status.sourceKind !== "project"}
    onChange={(layer, next) => void change(status, layer, next)}
  />
{/snippet}

{#snippet detail(status: PromptSuggestionStatus)}
  {@const decision = suggestionTrustState(status)}
  {#if decision}
    <ConfigurationReviewCallout
      state={decision}
      effect="it is not shown"
      changedSinceDecision={status.status === "stale"}
      busy={openReview.current?.busy}
      error={openReview.current?.notice ?? openReview.current?.error}
      onTrust={() => review(status)}
      onDecline={() => void openReview.current?.decline()}
      onRevoke={() => void openReview.current?.decline()}
      showTrusted
    />
  {/if}
  <div class="flex flex-wrap items-center gap-2">
    <Badge variant="neutral"
      >{status.sourceKind === "builtin"
        ? "Built-in"
        : status.sourceKind === "project"
          ? "Project"
          : "User"}</Badge
    >
    {@render statusBadges(status)}
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
  {@const target = reviewTarget(status)}
  {#if target}
    <ItemReviewSections {target} item={openReview.current} />
  {/if}
{/snippet}

{#snippet notices()}
  {#if fileState && projectName}
    <ConfigurationReviewCallout
      state={fileState}
      subject="This project's suggestion settings file"
      busy={decidingFile}
      effect="the project uses your settings and its column is locked"
      showTrusted
      onTrust={() => void decideFile(true)}
      onDecline={() => void decideFile(false)}
      onRevoke={() => void decideFile(false)}
    />
  {/if}
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
    <PageHeader
      title={open?.label ?? itemId}
      description={open?.description}
      parent={{ label: "Suggestions", onBack: onCloseItem }}
      class="mb-1"
    >
      {#snippet below()}
        {#if open && !open.stale && !awaitsReview(open)}
          {@const values = suggestionSwitches(open)}
          <div class="pt-2">
            <LayerEnabledTable
              name={`${open.label} prompt suggestion`}
              description="Offer this suggestion in the composer."
              user={values.user}
              project={values.project}
              projectSet={values.projectSet}
              {projectName}
              projectOnly={open.sourceKind === "project"}
              {locked}
              inapplicable={open.overriddenBy === "project" &&
                open.sourceKind !== "project"}
              onChange={(layer, next) => void change(open, layer, next)}
            />
          </div>
        {/if}
      {/snippet}
    </PageHeader>
  {/if}
  {@render notices()}
  {#if open}
    {@render detail(open)}
  {:else if loading}
    <Skeleton class="h-10 w-full" />
  {:else}
    <PageEmptyState
      variant="card"
      title="Suggestion not found"
      description={`No prompt suggestion is registered as “${itemId}”.`}
    />
  {/if}
{:else}
  {#if statuses.length >= SETTINGS_SEARCH_MIN}
    <SearchInput
      bind:value={query}
      placeholder="Search suggestions"
      ariaLabel="Search prompt suggestions"
      class="max-w-xs"
    />
  {/if}

  {@render notices()}

  {#if loading}
    <div class="grid gap-1.5">
      <Skeleton class="h-9 w-full" />
      <Skeleton class="h-9 w-full" />
      <Skeleton class="h-9 w-full" />
    </div>
  {:else}
    {#each groups as group (group.source)}
      <OriginGroup
        origin={group.origin}
        count={group.rows.length}
        {projectName}
        {locked}
        emptyText={group.source !== "builtin" && !query.trim()
          ? emptyCopy[group.source]
          : undefined}
        emptyDescription="Create one to offer your own prompt in the composer."
      >
        {#snippet emptyAction()}
          <Button
            size="sm"
            variant="outline"
            onclick={() =>
              pageState.openCreate(
                group.source === "project" ? "project" : "user",
              )}>New suggestion</Button
          >
        {/snippet}
        {#each group.rows as status (status.definitionKey)}
          <PageItem
            title={status.label}
            icon={Lightbulb}
            summary={status.description ?? status.conditionSummary}
            muted={!!status.overriddenBy}
            problem={awaitsReview(status)
              ? "Waiting for your review"
              : undefined}
            problemAction={awaitsReview(status)
              ? {
                  label: "Review",
                  onclick: () => review(status),
                }
              : undefined}
            onOpen={() => onOpenItem?.(status.definitionKey)}
            openLabel={`Open ${status.label}`}
          >
            {#snippet badges()}
              {@render statusBadges(status)}
            {/snippet}
            {#snippet meta()}
              {@render switches(status)}
            {/snippet}
          </PageItem>
        {/each}
      </OriginGroup>
    {/each}
  {/if}
{/if}

<CreatePromptSuggestionDialog
  bind:open={pageState.createDialogOpen}
  project={activeProject}
  initialScope={pageState.createScope}
  onCreate={create}
/>
