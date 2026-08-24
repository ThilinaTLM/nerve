<script lang="ts">
import Plus from "@lucide/svelte/icons/plus";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import type { PermissionException, ProjectRecord, Settings } from "$lib/api";
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

const permissionItems: SettingsChoice[] = [
  {
    value: "read_only",
    label: "Read only",
    detail: "Inspect local files. Block commands, network access, and changes.",
  },
  {
    value: "supervised",
    label: "Supervised",
    detail:
      "Allow safe reads. Ask before other actions unless an exception applies.",
  },
  {
    value: "autonomous",
    label: "Autonomous",
    detail:
      "Run tools without asking. Explicit denies and safeguards still apply.",
  },
];

const projectExceptions = $derived(
  controller.projectPermissions?.exceptions ?? [],
);
const userExceptions = $derived(settingsDraft.permissions.exceptions);
const projectPendingIds = $derived(
  projectExceptions
    .filter((exception) => controller.isPending("project", exception.id))
    .map((exception) => exception.id),
);
const userPendingIds = $derived(
  userExceptions
    .filter((exception) => controller.isPending("user", exception.id))
    .map((exception) => exception.id),
);

function setDefaultPermission(value: string): void {
  const permission = value as Settings["defaultPermissionLevel"];
  settingsDraft.defaultPermissionLevel = permission;
  onSettingsChange?.(
    { defaultPermissionLevel: permission },
    { immediate: true },
  );
}

async function addProject(exception: PermissionException): Promise<boolean> {
  return controller.add("project", exception, userExceptions);
}

async function addUser(exception: PermissionException): Promise<boolean> {
  return controller.add("user", exception, userExceptions);
}
</script>

<SettingsSection
  id="default-permission"
  title="Default permission"
  description="Choose the starting behavior for new agents. Current conversations keep their selected level."
>
  <SettingsGroup>
    <SettingsRow label="Permission level" layout="stacked">
      <SettingsChoiceCards
        items={permissionItems}
        value={settingsDraft.defaultPermissionLevel}
        ariaLabel="Default permission level"
        variant="radio"
        onValueChange={setDefaultPermission}
      />
    </SettingsRow>
  </SettingsGroup>
</SettingsSection>

<SettingsSection
  id="project-exceptions"
  title="Project Exceptions"
  description={activeProject
    ? `Rules that apply only to ${activeProject.name}. Project rules and user rules are evaluated together.`
    : "Select a project to manage rules that apply only to that project."}
>
  {#if controller.toolsError}
    <SettingsInlineMessage tone="error" text={controller.toolsError}>
      {#snippet actions()}
        <Button
          size="xs"
          variant="outline"
          onclick={() => controller.retryTools()}>Retry</Button
        >
      {/snippet}
    </SettingsInlineMessage>
  {/if}

  {#if controller.projectError}
    <SettingsInlineMessage tone="error" text={controller.projectError}>
      {#snippet actions()}
        <Button
          size="xs"
          variant="outline"
          onclick={() => controller.retryProject()}>Retry</Button
        >
      {/snippet}
    </SettingsInlineMessage>
  {/if}

  <div class="flex items-center justify-between gap-3">
    <p class="text-xs text-muted-foreground">
      Allows skip prompts only in Supervised. Denies apply to every permission
      level.
    </p>
    <Button
      size="sm"
      variant="outline"
      disabled={!activeProject ||
        controller.projectLoading ||
        controller.toolsLoading ||
        controller.tools.length === 0 ||
        !controller.projectPermissions}
      onclick={() => (projectDialogOpen = true)}
    >
      <Plus class="size-3.5" />Add exception
    </Button>
  </div>

  {#if controller.projectLoading}
    <div class="flex items-center gap-2 py-2 text-sm text-muted-foreground">
      <Spinner class="size-4" />Loading project exceptions…
    </div>
  {:else}
    <PermissionExceptionList
      exceptions={projectExceptions}
      pendingIds={projectPendingIds}
      emptyTitle={activeProject
        ? "No project exceptions"
        : "No project selected"}
      onRemove={(id) => void controller.remove("project", id, userExceptions)}
    />
  {/if}
</SettingsSection>

<SettingsSection
  id="user-exceptions"
  title="User Exceptions"
  description="Rules stored in your user profile and applied to every project. A deny always wins over an allow."
>
  {#if controller.userError}
    <SettingsInlineMessage tone="error" text={controller.userError} />
  {/if}

  <div class="flex items-center justify-between gap-3">
    <p class="text-xs text-muted-foreground">
      Keep user-wide rules focused because they affect every current and future
      project.
    </p>
    <Button
      size="sm"
      variant="outline"
      disabled={controller.toolsLoading || controller.tools.length === 0}
      onclick={() => (userDialogOpen = true)}
    >
      <Plus class="size-3.5" />Add exception
    </Button>
  </div>

  <PermissionExceptionList
    exceptions={userExceptions}
    pendingIds={userPendingIds}
    emptyTitle="No user exceptions"
    onRemove={(id) => void controller.remove("user", id, userExceptions)}
  />
</SettingsSection>

<PermissionExceptionDialog
  bind:open={projectDialogOpen}
  scopeLabel="Project"
  tools={controller.tools}
  onSave={addProject}
/>
<PermissionExceptionDialog
  bind:open={userDialogOpen}
  scopeLabel="User"
  tools={controller.tools}
  onSave={addUser}
/>
