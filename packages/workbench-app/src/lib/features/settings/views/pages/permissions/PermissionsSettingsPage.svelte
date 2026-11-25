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
import UntrustedProjectCallout from "../capabilities/UntrustedProjectCallout.svelte";
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
let trusting = $state(false);
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

async function trustProject(): Promise<void> {
  if (!projectId || trusting) return;
  trusting = true;
  actionError = await controller.trustProject(projectId);
  trusting = false;
  configurationAttention.refreshSoon();
}

/** Declines the project's file, or revokes a trusted one. */
async function declineProject(): Promise<void> {
  if (!projectId || trusting) return;
  trusting = true;
  // The daemon's own name for the file, from its report of what waits for the user.
  const reported = configurationAttention.resources.find(
    (resource) =>
      resource.kind === "permission-overlay" && resource.scope === "project",
  )?.path;
  actionError = await controller.declineProject(projectId, reported);
  trusting = false;
  configurationAttention.refreshSoon();
}

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
    <UntrustedProjectCallout
      state={fileState}
      subject="This project's permission rules file"
      effect="its rule overrides don't apply"
      busy={trusting}
      showTrusted
      onTrust={() => void trustProject()}
      onDecline={() => void declineProject()}
      onRevoke={() => void declineProject()}
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
      {trusting}
      onEdit={(editScope, rule) => edit(openRuleSet.id, editScope, rule)}
      onTrustProject={() => void trustProject()}
      onDeclineProject={() => void declineProject()}
    />
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
            onOpen={() => onOpenItem?.(ruleSet.id)}
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
