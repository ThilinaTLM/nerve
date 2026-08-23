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
let dialogOpen = $state(false);

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
      "Run tools without asking. Explicit blocks and safeguards still apply.",
  },
];

const scopeItems = $derived<SettingsChoice[]>([
  {
    value: "project",
    label: "This project",
    detail: activeProject?.name ?? "No active project",
    disabled: !activeProject,
  },
  {
    value: "global",
    label: "All projects",
    detail: "Apply across every project",
  },
]);

const visibleExceptions = $derived(
  controller.exceptions(settingsDraft.permissions.exceptions),
);

function setDefaultPermission(value: string): void {
  const permission = value as Settings["defaultPermissionLevel"];
  settingsDraft.defaultPermissionLevel = permission;
  onSettingsChange?.(
    { defaultPermissionLevel: permission },
    { immediate: true },
  );
}

function setScope(value: string): void {
  controller.scope = value as "project" | "global";
  controller.error = undefined;
}

async function addException(exception: PermissionException): Promise<boolean> {
  return controller.add(exception, settingsDraft.permissions.exceptions);
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
        onValueChange={setDefaultPermission}
      />
    </SettingsRow>
  </SettingsGroup>
</SettingsSection>

<SettingsSection
  id="exceptions"
  title="Exceptions"
  description="Allow exceptions only skip prompts in Supervised; they do not expand Read only or affect Autonomous. Block exceptions apply to every permission level."
>
  <SettingsGroup>
    <SettingsRow label="Scope" layout="stacked">
      <SettingsChoiceCards
        items={scopeItems}
        value={controller.scope}
        ariaLabel="Permission exception scope"
        variant="radio"
        onValueChange={setScope}
      />
    </SettingsRow>
  </SettingsGroup>

  {#if controller.scope === "global"}
    <SettingsInlineMessage
      tone="warning"
      text="Global exceptions apply to every project. A block always wins over an allow exception."
    />
  {/if}

  {#if controller.error}
    <SettingsInlineMessage tone="error" text={controller.error}>
      {#snippet actions()}
        {#if controller.scope === "project"}
          <Button size="xs" variant="outline" onclick={() => controller.retry()}
            >Retry</Button
          >
        {/if}
      {/snippet}
    </SettingsInlineMessage>
  {/if}

  <div class="flex items-center justify-between gap-2">
    <p class="text-xs text-muted-foreground">
      To add a Bash command or tool allow exception, review it in Supervised and
      choose Always in project or Always globally. Nerve derives an exact-risk
      exception from that request; command prefixes cannot be entered manually
      here.
    </p>
    <Button
      size="sm"
      variant="outline"
      disabled={controller.scope === "project" &&
        (controller.loading || !controller.projectPermissions)}
      onclick={() => (dialogOpen = true)}
    >
      <Plus class="size-3.5" />Add exception
    </Button>
  </div>

  {#if controller.scope === "project" && controller.loading}
    <div class="flex items-center gap-2 py-2 text-sm text-muted-foreground">
      <Spinner class="size-4" />Loading project exceptions…
    </div>
  {:else}
    <PermissionExceptionList
      exceptions={visibleExceptions}
      pendingIds={controller.pendingIds}
      onRemove={(id) =>
        void controller.remove(id, settingsDraft.permissions.exceptions)}
    />
  {/if}
</SettingsSection>

<PermissionExceptionDialog bind:open={dialogOpen} onSave={addException} />
