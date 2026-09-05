<script lang="ts">
import Plus from "@lucide/svelte/icons/plus";
import RefreshCw from "@lucide/svelte/icons/refresh-cw";
import ShieldCheck from "@lucide/svelte/icons/shield-check";
import ShieldAlert from "@lucide/svelte/icons/shield-alert";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import SelectField from "@nervekit/ui-kit/components/composites/select-field";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import type { PermissionRule, ProjectRecord, Settings } from "$lib/api";
import {
  SettingsChoiceCards,
  SettingsGroup,
  SettingsInlineMessage,
  SettingsList,
  SettingsRow,
  SettingsSection,
  type SettingsChoice,
} from "$lib/presentation/settings";
import type { SettingsChange } from "../settings-change";
import PermissionExceptionDialog from "./PermissionExceptionDialog.svelte";
import PermissionExceptionList from "./PermissionExceptionList.svelte";
import type { PermissionsPageState } from "./permissions-page-state.svelte";

type Props = {
  settingsDraft: Settings;
  activeProject?: ProjectRecord;
  controller: PermissionsPageState;
  onSettingsChange?: SettingsChange;
};

let { settingsDraft, activeProject, controller, onSettingsChange }: Props =
  $props();
let projectDialogOpen = $state(false);
let userDialogOpen = $state(false);
let editingProjectRule = $state<PermissionRule>();
let editingUserRule = $state<PermissionRule>();

$effect(() => controller.selectProject(activeProject));
$effect(() =>
  controller.selectRuleSet(
    settingsDraft.defaultPermissionRuleSetId ??
      settingsDraft.defaultPermissionLevel,
  ),
);

const builtInPermissionItems: SettingsChoice[] = [
  {
    value: "read_only",
    label: "Read only",
    detail:
      "Allow interaction, local inspection, and Explore. Deny every other capability.",
  },
  {
    value: "supervised",
    label: "Supervised",
    detail:
      "Allow interaction and local inspection. Prompt for other capabilities.",
  },
  {
    value: "autonomous",
    label: "Autonomous",
    detail:
      "Allow valid requests unless an overlay or guardrail replaces the decision.",
  },
];

const permissionItems = $derived<SettingsChoice[]>(
  controller.configuration
    ? controller.configuration.ruleSets
        .filter(
          (ruleSet) =>
            ruleSet.id !== "baseline" &&
            ruleSet.id !== "planning" &&
            ruleSet.available &&
            ruleSet.enabled &&
            (ruleSet.compatibleModes === undefined ||
              ruleSet.compatibleModes.includes("coding")),
        )
        .map((ruleSet) => ({
          value: ruleSet.id,
          label: ruleSet.name,
          detail:
            ruleSet.description ??
            (ruleSet.source === "user"
              ? "Custom user permission rule set"
              : "Built-in permission rule set"),
        }))
    : builtInPermissionItems,
);

const overlayRuleSetItems = $derived(
  controller.configuration?.ruleSets.map((ruleSet) => ({
    value: ruleSet.id,
    label: ruleSet.name,
    detail: ruleSet.available
      ? ruleSet.description
      : "Unavailable; stored rules are dormant",
    disabled: !ruleSet.available && !hasRulesForRuleSet(ruleSet.id),
  })) ?? [],
);
const managedRuleSet = $derived(
  controller.configuration?.ruleSets.find(
    (ruleSet) => ruleSet.id === controller.overlayRuleSetId,
  ),
);
const canAddManagedRules = $derived(
  Boolean(managedRuleSet?.available && managedRuleSet.enabled),
);
const projectRules = $derived(controller.rules("project"));
const userRules = $derived(controller.rules("user"));
const projectPendingIds = $derived(
  projectRules
    .filter((rule) => controller.isPending("project", rule.id))
    .map((rule) => rule.id),
);
const userPendingIds = $derived(
  userRules
    .filter((rule) => controller.isPending("user", rule.id))
    .map((rule) => rule.id),
);
const trust = $derived(controller.configuration?.projectTrust);

function setDefaultPermission(value: string): void {
  settingsDraft.defaultPermissionRuleSetId = value;
  if (["read_only", "supervised", "autonomous"].includes(value)) {
    const permission = value as Settings["defaultPermissionLevel"];
    settingsDraft.defaultPermissionLevel = permission;
    onSettingsChange?.(
      {
        defaultPermissionLevel: permission,
        defaultPermissionRuleSetId: value,
      },
      { immediate: true },
    );
    return;
  }
  onSettingsChange?.(
    { defaultPermissionRuleSetId: value },
    { immediate: true },
  );
}

async function saveProject(rule: PermissionRule): Promise<boolean> {
  return editingProjectRule
    ? controller.update("project", editingProjectRule.id, rule)
    : controller.add("project", rule);
}

async function saveUser(rule: PermissionRule): Promise<boolean> {
  return editingUserRule
    ? controller.update("user", editingUserRule.id, rule)
    : controller.add("user", rule);
}

function hasRulesForRuleSet(ruleSetId: string): boolean {
  const configuration = controller.configuration;
  if (!configuration) return false;
  return [configuration.userOverlays, configuration.projectOverlays].some(
    (document) =>
      document.overlays.some(
        (overlay) =>
          overlay.ruleSetId === ruleSetId && overlay.rules.length > 0,
      ),
  );
}

function selectOverlayRuleSet(ruleSetId: string): void {
  projectDialogOpen = false;
  userDialogOpen = false;
  editingProjectRule = undefined;
  editingUserRule = undefined;
  controller.selectRuleSet(ruleSetId);
}

function openProjectRule(rule?: PermissionRule): void {
  editingProjectRule = rule;
  projectDialogOpen = true;
}

function openUserRule(rule?: PermissionRule): void {
  editingUserRule = rule;
  userDialogOpen = true;
}

function ruleSetRole(id: string, compatibleModes?: string[]): string {
  if (id === "baseline") return "Foundation";
  if (id === "planning") return "Planning";
  if (compatibleModes?.length) return compatibleModes.join(", ");
  return "Coding";
}
</script>

<SettingsSection
  id="default-permission"
  title="Default permission rule set"
  description="Choose the rule set for new coding agents. Planning always uses its fixed Planning rule set."
>
  <SettingsGroup>
    <SettingsRow label="Permission rule set" layout="stacked">
      <SettingsChoiceCards
        items={permissionItems}
        value={settingsDraft.defaultPermissionRuleSetId ??
          settingsDraft.defaultPermissionLevel}
        ariaLabel="Default permission rule set"
        variant="radio"
        onValueChange={setDefaultPermission}
      />
    </SettingsRow>
  </SettingsGroup>
</SettingsSection>

<SettingsSection
  id="permission-rule-sets"
  title="Permission rule sets"
  description="Built-in rule sets are read-only. Create or change user rule sets manually under <NERVE_HOME>/config/rule-sets/*.json."
>
  <div class="flex items-center justify-between gap-3">
    <p class="text-xs text-muted-foreground">
      Baseline is the primary-agent foundation. Planning is fixed while Planning
      mode is active.
    </p>
    <Button
      size="sm"
      variant="outline"
      disabled={!activeProject || controller.loading}
      onclick={() => controller.refresh()}
    >
      <RefreshCw
        class={`size-3.5 ${controller.loading ? "animate-spin" : ""}`}
      />Refresh
    </Button>
  </div>
  {#if controller.configuration}
    <SettingsList ariaLabel="Permission rule sets" divided={false} gap="sm">
      {#each controller.configuration.ruleSets as ruleSet (ruleSet.id)}
        <div
          role="listitem"
          class:opacity-55={!ruleSet.enabled || !ruleSet.available}
          class="grid gap-1 rounded-md border border-transparent bg-accent/90 px-3 py-2 dark:bg-accent/60"
        >
          <div class="flex items-center justify-between gap-3">
            <p class="truncate text-sm font-medium">{ruleSet.name}</p>
            <div
              class="flex shrink-0 items-center gap-2 text-xs text-muted-foreground"
            >
              <span>{ruleSet.source === "builtin" ? "Built-in" : "User"}</span>
              <span class="capitalize"
                >{ruleSetRole(ruleSet.id, ruleSet.compatibleModes)}</span
              >
              {#if (settingsDraft.defaultPermissionRuleSetId ?? settingsDraft.defaultPermissionLevel) === ruleSet.id}
                <span class="font-medium text-primary">Default</span>
              {/if}
              {#if !ruleSet.enabled}<span>Disabled</span>{/if}
            </div>
          </div>
          {#if ruleSet.description}
            <p class="text-xs text-muted-foreground">{ruleSet.description}</p>
          {/if}
        </div>
      {/each}
    </SettingsList>
  {:else if controller.loading}
    <div class="flex items-center gap-2 py-2 text-sm text-muted-foreground">
      <Spinner class="size-4" />Loading permission rule sets…
    </div>
  {/if}
</SettingsSection>

<SettingsSection
  id="permission-overlay-target"
  title="Manage permission overlays"
  description="Choose the permission rule set whose user and project overlays you want to inspect or edit."
>
  <SettingsGroup>
    <SettingsRow label="Permission rule set" layout="stacked">
      <SelectField
        items={overlayRuleSetItems}
        value={controller.overlayRuleSetId}
        placeholder="Select a permission rule set"
        ariaLabel="Overlay permission rule set"
        onValueChange={selectOverlayRuleSet}
      />
    </SettingsRow>
  </SettingsGroup>
  {#if managedRuleSet && !managedRuleSet.available}
    <SettingsInlineMessage
      tone="warning"
      text="This rule set is unavailable. Its stored rules are dormant and may only be inspected or removed."
    />
  {/if}
</SettingsSection>

{#if controller.errorMessage}
  <SettingsInlineMessage tone="error" text={controller.errorMessage}>
    {#snippet actions()}
      <Button size="xs" variant="outline" onclick={() => controller.retry()}
        >Retry</Button
      >
    {/snippet}
  </SettingsInlineMessage>
{/if}

{#if controller.configuration?.diagnostics.length}
  {#each controller.configuration.diagnostics as diagnostic (diagnostic)}
    <SettingsInlineMessage tone="warning" text={diagnostic} />
  {/each}
{/if}

<SettingsSection
  id="project-permissions"
  title="Project permission overlay"
  description={activeProject
    ? `Repository-controlled ${managedRuleSet?.name ?? controller.overlayRuleSetId} rules for ${activeProject.name}. The complete file digest must be trusted before these rules become active.`
    : "Select a project to inspect and manage its permission overlay."}
>
  {#if controller.loading}
    <div class="flex items-center gap-2 py-2 text-sm text-muted-foreground">
      <Spinner class="size-4" />Loading permission policy…
    </div>
  {:else if activeProject && trust}
    <div
      class="flex items-center justify-between gap-3 rounded-md border bg-card px-3 py-2"
    >
      <div class="flex min-w-0 items-center gap-2">
        {#if trust.status === "trusted"}
          <ShieldCheck class="size-4 shrink-0 text-success" />
        {:else}
          <ShieldAlert class="size-4 shrink-0 text-warning" />
        {/if}
        <div class="min-w-0">
          <p class="text-sm font-medium capitalize">{trust.status}</p>
          <p class="truncate text-xs text-muted-foreground">
            {trust.reason ??
              trust.digest ??
              "No project overlay has been discovered."}
          </p>
        </div>
      </div>
      {#if trust.status === "untrusted"}
        <Button
          size="sm"
          variant="outline"
          disabled={controller.isPending("project", "trust")}
          onclick={() => void controller.setTrusted(true)}
          >Trust current digest</Button
        >
      {:else if trust.status === "trusted"}
        <Button
          size="sm"
          variant="outline"
          disabled={controller.isPending("project", "trust")}
          onclick={() => void controller.setTrusted(false)}>Revoke trust</Button
        >
      {/if}
    </div>
  {/if}

  <div class="flex items-center justify-between gap-3">
    <p class="text-xs text-muted-foreground">
      These rules apply only to the {managedRuleSet?.name ??
        controller.overlayRuleSetId} permission rule set. Project rules override ordinary
      user defaults but never user guardrails in that set.
    </p>
    <Button
      size="sm"
      variant="outline"
      disabled={!activeProject ||
        !controller.configuration ||
        controller.loading ||
        !canAddManagedRules}
      onclick={() => openProjectRule()}
      ><Plus class="size-3.5" />Add rule</Button
    >
  </div>
  <PermissionExceptionList
    rules={projectRules}
    pendingIds={projectPendingIds}
    emptyTitle={activeProject ? "No project rules" : "No project selected"}
    onEdit={canAddManagedRules ? (rule) => openProjectRule(rule) : undefined}
    onRemove={(id) => void controller.remove("project", id)}
  />
</SettingsSection>

<SettingsSection
  id="user-permissions"
  title="User permission overlay"
  description={`Defaults and protected guardrails for ${managedRuleSet?.name ?? controller.overlayRuleSetId}, stored under your Nerve home and applied across primary-agent projects using that rule set.`}
>
  <div class="flex items-center justify-between gap-3">
    <p class="text-xs text-muted-foreground">
      A guardrail may prompt or deny and cannot be replaced by project or
      conversation rules within this permission rule set.
    </p>
    <Button
      size="sm"
      variant="outline"
      disabled={!activeProject ||
        !controller.configuration ||
        controller.loading ||
        !canAddManagedRules}
      onclick={() => openUserRule()}><Plus class="size-3.5" />Add rule</Button
    >
  </div>
  <PermissionExceptionList
    rules={userRules}
    pendingIds={userPendingIds}
    emptyTitle="No user rules"
    onEdit={canAddManagedRules ? (rule) => openUserRule(rule) : undefined}
    onRemove={(id) => void controller.remove("user", id)}
  />
</SettingsSection>

<PermissionExceptionDialog
  bind:open={projectDialogOpen}
  scope="project"
  ruleSetId={controller.overlayRuleSetId}
  rule={editingProjectRule}
  onSave={saveProject}
/>
<PermissionExceptionDialog
  bind:open={userDialogOpen}
  scope="user"
  ruleSetId={controller.overlayRuleSetId}
  rule={editingUserRule}
  onSave={saveUser}
/>
