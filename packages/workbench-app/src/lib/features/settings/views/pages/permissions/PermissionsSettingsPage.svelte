<script lang="ts">
import { Callout } from "@nervekit/ui-kit/components/composites/callout";
import type { PermissionRule } from "@nervekit/contracts/permissions";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import type { Settings } from "$lib/api";
import {
  SettingsEmptyState,
  SettingsList,
  SettingsPageHeader,
  SettingsSection,
} from "$lib/presentation/settings";
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
  if (!projectId) return;
  trusting = true;
  actionError = await controller.trustProject(projectId);
  trusting = false;
}
</script>

{#if itemId && onCloseItem}
  <!-- The detail's page header; the shell leaves this slot to it. -->
  <SettingsPageHeader
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
    />
  {:else if configuration}
    <SettingsEmptyState
      variant="card"
      title="Rule set not found"
      description={`No rule set is registered as “${itemId}”.`}
    />
  {:else if !controller.error}
    <SettingsEmptyState
      variant="card"
      title="Loading rule set"
      description="Fetching permission rule sets and overrides."
    />
  {/if}
{:else}
  <SettingsSection
    id="rule-sets"
    title="Rule sets"
    surface={false}
    info="Overrides add rules to one rule set. User overrides apply to every project; project overrides apply only while the project file is trusted."
  >
    {@render notices()}
    {#if configuration}
      <SettingsList ariaLabel="Permission rule sets">
        {#each configuration.ruleSets as ruleSet (ruleSet.id)}
          <PermissionRuleSetItem
            {ruleSet}
            {configuration}
            isDefault={ruleSet.id === defaultId}
            onOpen={() => onOpenItem?.(ruleSet.id)}
          />
        {/each}
      </SettingsList>
    {:else if !controller.error}
      <SettingsEmptyState
        variant="card"
        title="Loading rule sets"
        description="Fetching permission rule sets and overrides."
      />
    {/if}
  </SettingsSection>
{/if}

{#if editing && editingRuleSet}
  <PermissionRuleDialog
    bind:open={dialogOpen}
    scope={editing.scope}
    ruleSetId={editingRuleSet.id}
    ruleSetName={editingRuleSet.name}
    scopeLabel={editing.scope === "user"
      ? "User overrides"
      : `Project overrides · ${projectName ?? "project"}`}
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
