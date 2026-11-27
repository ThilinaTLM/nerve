<script lang="ts">
import {
  PageEmptyState,
  PageHeader,
} from "@nervekit/ui-kit/components/composites/page";
import { Callout } from "@nervekit/ui-kit/components/composites/callout";
import type { PermissionRule } from "@nervekit/contracts/permissions";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import type { Settings } from "$lib/api";
import { OriginGroup } from "$lib/presentation/settings";
import { configurationAttention } from "$lib/application/configuration-attention/configuration-attention-state.svelte";
import {
  onConfigurationDecision,
  openConfigurationReview,
} from "$lib/application/configuration-review/configuration-review-queue.svelte";
import { pendingReviewState } from "$lib/application/configuration-review/review-resource-state";
import ConfigurationReviewCallout from "$lib/presentation/configuration-review/ConfigurationReviewCallout.svelte";
import ItemReviewSections from "../review/ItemReviewSections.svelte";
import { useItemReview } from "../review/item-review.svelte";
import PermissionRuleDialog from "./PermissionRuleDialog.svelte";
import PermissionRuleSetDetail from "./PermissionRuleSetDetail.svelte";
import PermissionRuleSetItem from "./PermissionRuleSetItem.svelte";
import type { PermissionsPageController } from "./permissions-page-state.svelte";
import { overridesFor, type OverrideScope } from "./permission-rule-sets-view";

type Props = {
  scope: OverrideScope;
  settingsDraft: Settings;
  controller: PermissionsPageController;
  projectId?: string;
  projectName?: string;
  /** The open rule set; "" shows the list. */
  itemId?: string;
  onOpenItem?: (id: string) => void;
  /** Leaves the open rule set for the list. */
  onCloseItem?: () => void;
};

let {
  settingsDraft,
  controller,
  projectId,
  projectName,
  itemId = "",
  onOpenItem,
  onCloseItem,
}: Props = $props();

$effect(() => {
  void controller.load(projectId);
});

const configuration = $derived(controller.configuration);
const openRuleSet = $derived(
  itemId
    ? configuration?.ruleSets.find((ruleSet) => ruleSet.id === itemId)
    : undefined,
);
const userRuleSets = $derived(
  configuration?.ruleSets.filter((ruleSet) => ruleSet.source !== "builtin") ??
    [],
);
const builtinRuleSets = $derived(
  configuration?.ruleSets.filter((ruleSet) => ruleSet.source === "builtin") ??
    [],
);
const defaultId = $derived(settingsDraft.defaultPermissionRuleSetId);

type Editing = {
  scope: OverrideScope;
  ruleSetId: string;
  rule?: PermissionRule;
};
let editing = $state<Editing>();
let dialogOpen = $state(false);
let actionError = $state<string>();

const editingRuleSet = $derived(
  configuration?.ruleSets.find((ruleSet) => ruleSet.id === editing?.ruleSetId),
);
const overlayRules = $derived(
  configuration && editing
    ? overridesFor(configuration, editing.scope, editing.ruleSetId)
    : [],
);

function edit(
  ruleSetId: string,
  editScope: OverrideScope,
  rule?: PermissionRule,
): void {
  editing = { scope: editScope, ruleSetId, rule };
  dialogOpen = true;
}

function target() {
  if (!editing) throw new Error("No rule is being edited.");
  return {
    scope: editing.scope,
    ruleSetId: editing.ruleSetId,
    ...(editing.scope === "project" ? { projectId } : {}),
  };
}

const projectFileTarget = $derived(
  projectId
    ? {
        kind: "permission-overlay" as const,
        scope: "project" as const,
        projectId,
        id: "permissions.json",
      }
    : undefined,
);

// The project's file: Decline and Revoke decide on the content its review read.
const projectFileReview = useItemReview(() =>
  fileState ? projectFileTarget : undefined,
);
/** Declines the project's file, or revokes a trusted one. */
function declineProject(): void {
  void projectFileReview.current?.decline();
}

// User rule sets and the user's permissions file: a waiting decision comes
// from the registry; a declined file (which asks for nothing) from its review.
const resources = $derived(configurationAttention.resources);
const userFileTarget = {
  kind: "permission-overlay" as const,
  scope: "user" as const,
  id: "permissions.json",
};
const userFileReview = useItemReview(() => userFileTarget);
const userFileState = $derived.by(() => {
  const reviewed = userFileReview.current?.review?.state;
  return (
    pendingReviewState(
      resources,
      "permission-overlay",
      "user",
      "permissions.json",
    ) ?? (reviewed && reviewed !== "trusted" ? reviewed : undefined)
  );
});
const ruleSetState = (id: string) =>
  pendingReviewState(resources, "rule-set", "user", id);
const ruleSetTarget = (id: string) => ({
  kind: "rule-set" as const,
  scope: "user" as const,
  id,
});

// The open user rule set: its decision callout and what it can do.
const openRuleSetTarget = $derived(
  openRuleSet && openRuleSet.source !== "builtin"
    ? ruleSetTarget(openRuleSet.id)
    : undefined,
);
const openRuleSetReview = useItemReview(() => openRuleSetTarget);
const openRuleSetState = $derived.by(() => {
  if (!openRuleSetTarget || !openRuleSet) return undefined;
  const reviewed = openRuleSetReview.current?.review?.state;
  return (
    ruleSetState(openRuleSet.id) ??
    (reviewed && reviewed !== "trusted" ? reviewed : undefined)
  );
});

// A decision in the review dialog changes what applies: read the rules again.
$effect(() =>
  onConfigurationDecision((review) => {
    if (
      review.target.kind === "rule-set" ||
      review.target.kind === "permission-overlay"
    ) {
      void controller.load(projectId);
      configurationAttention.refreshSoon();
    }
  }),
);

/** The decision on the project's permissions file, when it has one to make. */
const fileState = $derived.by(() => {
  const status = configuration?.projectTrust.status;
  return projectId &&
    projectName &&
    (status === "needs_review" || status === "declined" || status === "trusted")
    ? status
    : undefined;
});
</script>

{#if itemId && onCloseItem}
  <!-- The detail's page header; the shell leaves this slot to it. -->
  <PageHeader
    title={openRuleSet?.name ?? itemId}
    description={openRuleSet?.description}
    parent={{ label: "Permission rules", onBack: onCloseItem }}
    class="mb-1"
  />
{/if}

{#snippet notices()}
  {#if controller.error}
    <Callout layout="block" tone="destructive" text={controller.error}>
      {#snippet actions()}
        <Button
          variant="outline"
          size="sm"
          onclick={() => void controller.load(projectId)}>Retry</Button
        >
      {/snippet}
    </Callout>
  {/if}
  {#if actionError}
    <Callout layout="block" tone="destructive" text={actionError} />
  {/if}
  {#if fileState && !itemId}
    <ConfigurationReviewCallout
      state={fileState}
      subject="This project's permission rules file"
      effect="its rule overrides don't apply"
      busy={projectFileReview.current?.busy}
      error={projectFileReview.current?.notice ??
        projectFileReview.current?.error}
      showTrusted
      onTrust={() =>
        projectFileTarget && openConfigurationReview([projectFileTarget])}
      onDecline={declineProject}
      onRevoke={declineProject}
    />
  {/if}
  {#if openRuleSetTarget && openRuleSetState && itemId}
    <ConfigurationReviewCallout
      state={openRuleSetState}
      effect="it can't be selected; where it is the default, the last version you trusted stays in effect"
      changedSinceDecision={openRuleSetReview.current?.review
        ?.changedSinceDecision}
      busy={openRuleSetReview.current?.busy}
      error={openRuleSetReview.current?.notice ??
        openRuleSetReview.current?.error}
      onTrust={() => openRuleSetReview.current?.trust()}
      onDecline={() => void openRuleSetReview.current?.decline()}
    />
  {/if}
  {#if userFileState && !itemId}
    <ConfigurationReviewCallout
      state={userFileState}
      subject="Your permission rules file"
      effect="the last version you trusted stays in effect"
      busy={userFileReview.current?.busy}
      error={userFileReview.current?.notice ?? userFileReview.current?.error}
      onTrust={() => openConfigurationReview([userFileTarget])}
      onDecline={() => void userFileReview.current?.decline()}
    />
  {/if}
  {#each configuration?.diagnostics ?? [] as diagnostic (diagnostic)}
    <Callout layout="block" tone="warning" text={diagnostic} />
  {/each}
{/snippet}

{#if itemId}
  {@render notices()}
  {#if configuration && openRuleSet}
    <PermissionRuleSetDetail
      ruleSet={openRuleSet}
      {configuration}
      isDefault={openRuleSet.id === defaultId}
      {projectName}
      trusting={projectFileReview.current?.busy}
      onEdit={(editScope, rule) => edit(openRuleSet.id, editScope, rule)}
      onTrustProject={() =>
        projectFileTarget && openConfigurationReview([projectFileTarget])}
      onDeclineProject={declineProject}
    />
    {#if openRuleSetTarget}
      <ItemReviewSections
        target={openRuleSetTarget}
        item={openRuleSetReview.current}
      />
    {/if}
  {:else if configuration}
    <PageEmptyState
      variant="card"
      title="Rule set not found"
      description={`No rule set is registered as “${itemId}”.`}
    />
  {:else if !controller.error}
    <PageEmptyState
      variant="card"
      title="Loading rule set"
      description="Fetching permission rule sets and overrides."
    />
  {/if}
{:else}
  {@render notices()}
  {#if configuration}
    {#each [{ kind: "user", ruleSets: userRuleSets }, { kind: "builtin", ruleSets: builtinRuleSets }] as const as group (group.kind)}
      <OriginGroup
        origin={{ kind: group.kind }}
        count={group.ruleSets.length}
        layers={false}
      >
        {#each group.ruleSets as ruleSet (ruleSet.id)}
          <PermissionRuleSetItem
            {ruleSet}
            {configuration}
            isDefault={ruleSet.id === defaultId}
            reviewState={ruleSet.source === "builtin"
              ? undefined
              : ruleSetState(ruleSet.id)}
            onOpen={() => onOpenItem?.(ruleSet.id)}
            onReview={() =>
              openConfigurationReview([ruleSetTarget(ruleSet.id)])}
          />
        {/each}
      </OriginGroup>
    {/each}
  {:else if !controller.error}
    <PageEmptyState
      variant="card"
      title="Loading rule sets"
      description="Fetching permission rule sets and overrides."
    />
  {/if}
{/if}

{#if editing && editingRuleSet}
  <PermissionRuleDialog
    bind:open={dialogOpen}
    scope={editing.scope}
    ruleSetId={editingRuleSet.id}
    ruleSetName={editingRuleSet.name}
    scopeLabel={editing.scope === "user"
      ? "User overrides"
      : "Project overrides"}
    rule={editing.rule}
    {overlayRules}
    onSave={(rule) => {
      actionError = undefined;
      return controller.saveRule(target(), rule, editing?.rule?.id);
    }}
    onDelete={editing.rule
      ? () => {
          actionError = undefined;
          return controller.deleteRule(target(), editing?.rule?.id ?? "");
        }
      : undefined}
  />
{/if}
