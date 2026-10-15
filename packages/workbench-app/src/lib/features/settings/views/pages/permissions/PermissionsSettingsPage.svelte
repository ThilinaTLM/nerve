<script lang="ts">
import type { PermissionRule } from "@nervekit/contracts/permissions";
import SelectField from "@nervekit/ui-kit/components/composites/select-field";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import type { Settings } from "$lib/api";
import {
  SettingsEmptyState,
  SettingsInlineMessage,
  SettingsList,
  SettingsRow,
  SettingsSection,
} from "$lib/presentation/settings";
import type { SettingsChange } from "../settings-change";
import PermissionRuleDialog from "./PermissionRuleDialog.svelte";
import PermissionRuleSetItem from "./PermissionRuleSetItem.svelte";
import type { PermissionsPageController } from "./permissions-page-state.svelte";
import {
  isDefaultEligible,
  overridesFor,
  type OverrideScope,
} from "./permission-rule-sets-view";

type Props = {
  scope: OverrideScope;
  settingsDraft: Settings;
  controller: PermissionsPageController;
  projectId?: string;
  projectName?: string;
  onSettingsChange?: SettingsChange;
  onScopeChange?: (scope: OverrideScope) => void;
};

let {
  scope,
  settingsDraft,
  controller,
  projectId,
  projectName,
  onSettingsChange,
  onScopeChange,
}: Props = $props();

$effect(() => {
  void controller.load(projectId);
});

const configuration = $derived(controller.configuration);
const defaultOptions = $derived(
  (configuration?.ruleSets ?? [])
    .filter(isDefaultEligible)
    .map((ruleSet) => ({ value: ruleSet.id, label: ruleSet.name })),
);
const defaultId = $derived(settingsDraft.defaultPermissionRuleSetId);
const defaultKnown = $derived(
  defaultOptions.some((option) => option.value === defaultId),
);
const defaultName = $derived(
  configuration?.ruleSets.find((ruleSet) => ruleSet.id === defaultId)?.name ??
    defaultId,
);

function changeDefault(id: string): void {
  if (id === settingsDraft.defaultPermissionRuleSetId) return;
  settingsDraft.defaultPermissionRuleSetId = id;
  onSettingsChange?.({ defaultPermissionRuleSetId: id }, { immediate: true });
}

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

<SettingsSection
  id="default"
  title="Default"
  info="New conversations start with this rule set. Existing conversations keep their selection, and planning mode always uses Planning."
>
  {#if !configuration && controller.loading}
    <p class="py-1.5 text-xs text-muted-foreground">Loading permissions…</p>
  {:else if scope === "user"}
    <SettingsRow
      label="Default rule set"
      description="Used when a new coding conversation starts."
    >
      {#snippet control()}
        <div class="w-48 min-w-0">
          <SelectField
            items={defaultOptions}
            value={defaultKnown ? defaultId : ""}
            placeholder={defaultName}
            ariaLabel="Default permission rule set"
            disabled={!configuration}
            onValueChange={changeDefault}
          />
        </div>
      {/snippet}
    </SettingsRow>
  {:else}
    <SettingsRow
      label="Default rule set"
      description="Configured for every project in your user settings."
    >
      {#snippet control()}
        <div class="flex items-center gap-2">
          <span class="text-sm text-foreground">{defaultName}</span>
          <Button
            variant="outline"
            size="sm"
            onclick={() => onScopeChange?.("user")}>Change</Button
          >
        </div>
      {/snippet}
    </SettingsRow>
  {/if}
  {#if configuration && !defaultKnown}
    <SettingsInlineMessage
      tone="warning"
      text={`The saved default “${defaultName}” can no longer be used. Choose another rule set.`}
    />
  {/if}
  {#if settingsDraft.rememberLastAgentSelection}
    <SettingsInlineMessage
      tone="info"
      text="Remember last agent selection is on, so new conversations start with the last used rule set. Turn it off in Models to always use this default."
    />
  {/if}
</SettingsSection>

<SettingsSection
  id="rule-sets"
  title="Rule sets"
  surface={false}
  info="Overrides add rules to one rule set. User overrides apply to every project; project overrides apply only while the project file is trusted."
>
  {#if controller.error}
    <SettingsInlineMessage tone="destructive" text={controller.error}>
      {#snippet actions()}
        <Button
          variant="outline"
          size="sm"
          onclick={() => void controller.load(projectId)}>Retry</Button
        >
      {/snippet}
    </SettingsInlineMessage>
  {/if}
  {#if actionError}
    <SettingsInlineMessage tone="destructive" text={actionError} />
  {/if}
  {#each configuration?.diagnostics ?? [] as diagnostic (diagnostic)}
    <SettingsInlineMessage tone="warning" text={diagnostic} />
  {/each}
  {#if configuration}
    <SettingsList ariaLabel="Permission rule sets">
      {#each configuration.ruleSets as ruleSet (ruleSet.id)}
        <PermissionRuleSetItem
          {ruleSet}
          {configuration}
          isDefault={ruleSet.id === defaultId}
          {projectName}
          {trusting}
          onEdit={(editScope, rule) => edit(ruleSet.id, editScope, rule)}
          onTrustProject={() => void trustProject()}
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
