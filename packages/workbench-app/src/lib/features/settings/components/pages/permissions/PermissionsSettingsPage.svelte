<script lang="ts">
import Plus from "@lucide/svelte/icons/plus";
import ShieldCheck from "@lucide/svelte/icons/shield-check";
import ShieldAlert from "@lucide/svelte/icons/shield-alert";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import type { PermissionRule, ProjectRecord, Settings } from "$lib/api";
import {
  SettingsChoiceCards,
  SettingsGroup,
  SettingsInlineMessage,
  SettingsRow,
  SettingsSection,
  type SettingsChoice,
} from "$lib/presentation/components/settings";
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

$effect(() => controller.selectProject(activeProject));

const builtInPermissionItems: SettingsChoice[] = [
  {
    value: "read_only",
    label: "Read only",
    detail:
      "Allow interaction and local inspection. Deny every other base risk.",
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

const permissionItems = $derived<SettingsChoice[]>([
  ...builtInPermissionItems,
  ...(controller.configuration?.ruleSets ?? [])
    .filter(
      (ruleSet) =>
        ruleSet.source === "user" &&
        ruleSet.available &&
        ruleSet.enabled &&
        (ruleSet.compatibleModes === undefined ||
          ruleSet.compatibleModes.includes("coding")),
    )
    .map((ruleSet) => ({
      value: ruleSet.id,
      label: ruleSet.name,
      detail: ruleSet.description ?? "Custom user permission rule set",
    })),
]);

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

async function addProject(rule: PermissionRule): Promise<boolean> {
  return controller.add("project", rule);
}

async function addUser(rule: PermissionRule): Promise<boolean> {
  return controller.add("user", rule);
}
</script>

<SettingsSection
  id="default-permission"
  title="Default permission rule set"
  description="Choose the built-in rule set for new coding agents. Planning uses its fixed Planning rule set."
>
  <SettingsGroup>
    <SettingsRow label="Permission level" layout="stacked">
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
  {#if controller.configuration}
    <p class="text-xs text-muted-foreground">
      Available rule sets: {controller.configuration.ruleSets
        .filter((ruleSet) => ruleSet.available)
        .map((ruleSet) => ruleSet.name)
        .join(", ")}
    </p>
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
    ? `Repository-controlled rules for ${activeProject.name}. The complete file digest must be trusted before these rules become active.`
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
      Project rules override ordinary user defaults but never user guardrails.
    </p>
    <Button
      size="sm"
      variant="outline"
      disabled={!activeProject ||
        !controller.configuration ||
        controller.loading}
      onclick={() => (projectDialogOpen = true)}
      ><Plus class="size-3.5" />Add rule</Button
    >
  </div>
  <PermissionExceptionList
    rules={projectRules}
    pendingIds={projectPendingIds}
    emptyTitle={activeProject ? "No project rules" : "No project selected"}
    onRemove={(id) => void controller.remove("project", id)}
  />
</SettingsSection>

<SettingsSection
  id="user-permissions"
  title="User permission overlay"
  description="Defaults and protected guardrails stored under your Nerve home and applied across primary-agent projects."
>
  <div class="flex items-center justify-between gap-3">
    <p class="text-xs text-muted-foreground">
      A guardrail may prompt or deny and cannot be replaced by project or
      conversation rules.
    </p>
    <Button
      size="sm"
      variant="outline"
      disabled={!activeProject ||
        !controller.configuration ||
        controller.loading}
      onclick={() => (userDialogOpen = true)}
      ><Plus class="size-3.5" />Add rule</Button
    >
  </div>
  <PermissionExceptionList
    rules={userRules}
    pendingIds={userPendingIds}
    emptyTitle="No user rules"
    onRemove={(id) => void controller.remove("user", id)}
  />
</SettingsSection>

<PermissionExceptionDialog
  bind:open={projectDialogOpen}
  scope="project"
  onSave={addProject}
/>
<PermissionExceptionDialog
  bind:open={userDialogOpen}
  scope="user"
  onSave={addUser}
/>
