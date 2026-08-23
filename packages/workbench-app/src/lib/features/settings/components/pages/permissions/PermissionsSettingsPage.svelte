<script lang="ts">
import Trash2 from "@lucide/svelte/icons/trash-2";
import Plus from "@lucide/svelte/icons/plus";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import type {
  ProjectRecord,
  ProjectSupervisionPreferences,
  Settings,
  SupervisionGrant,
  ToolDescriptor,
} from "$lib/api";
import {
  SettingsChoiceCards,
  SettingsGroup,
  SettingsInlineMessage,
  SettingsKeyValueRow,
  SettingsList,
  SettingsRow,
  SettingsSection,
  SettingsSummaryRow,
  SettingsToggleRow,
  type SettingsChoice,
} from "$lib/presentation/components/settings";
import type { SettingsChange } from "../settings-change";

type Props = {
  settingsDraft: Settings;
  toolDescriptors?: ToolDescriptor[];
  toolDescriptorsLoading?: boolean;
  activeProject?: ProjectRecord;
  getProjectPermissions?: (
    projectId: string,
  ) => Promise<ProjectSupervisionPreferences>;
  updateProjectPermissions?: (
    projectId: string,
    permissions: ProjectSupervisionPreferences,
  ) => Promise<ProjectSupervisionPreferences>;
  onSettingsChange?: SettingsChange;
};

let {
  settingsDraft,
  toolDescriptors = [],
  toolDescriptorsLoading = false,
  activeProject,
  getProjectPermissions,
  updateProjectPermissions,
  onSettingsChange,
}: Props = $props();

let commandPrefix = $state("");
let projectCommandPrefix = $state("");
let projectPermissions = $state<ProjectSupervisionPreferences>();
let projectPermissionsLoading = $state(false);
let projectPermissionsError = $state<string>();

$effect(() => {
  const projectId = activeProject?.id;
  projectPermissions = undefined;
  projectPermissionsError = undefined;
  if (!projectId || !getProjectPermissions) return;
  projectPermissionsLoading = true;
  void getProjectPermissions(projectId)
    .then((permissions) => {
      if (activeProject?.id === projectId) projectPermissions = permissions;
    })
    .catch((error) => {
      if (activeProject?.id === projectId) {
        projectPermissionsError =
          error instanceof Error ? error.message : String(error);
      }
    })
    .finally(() => {
      if (activeProject?.id === projectId) projectPermissionsLoading = false;
    });
});
const permissionItems: SettingsChoice[] = [
  {
    value: "read_only",
    label: "Read only",
    detail: "Allow reads and reject mutation",
  },
  {
    value: "supervised",
    label: "Supervised",
    detail: "Ask before risky operations",
  },
  {
    value: "autonomous",
    label: "Autonomous",
    detail: "Allow after hard safety constraints",
  },
];

function setDefaultPermission(value: string): void {
  const permission = value as Settings["defaultPermissionLevel"];
  settingsDraft.defaultPermissionLevel = permission;
  onSettingsChange?.(
    { defaultPermissionLevel: permission },
    { immediate: true },
  );
}

function setAutoApproveReadOnly(autoApproveReadOnly: boolean): void {
  settingsDraft.defaultApprovalPolicy.autoApproveReadOnly = autoApproveReadOnly;
  onSettingsChange?.(
    { defaultApprovalPolicy: { autoApproveReadOnly } },
    { immediate: true },
  );
}

function saveGrants(grants: SupervisionGrant[]): void {
  settingsDraft.supervision.grants = grants;
  onSettingsChange?.({ supervision: { grants } }, { immediate: true });
}

function addCommandGrant(): void {
  const tokens = commandPrefix.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0 || tokens.length > 16) return;
  const duplicate = settingsDraft.supervision.grants.some(
    (grant) =>
      grant.target === "command_prefix" &&
      grant.tokens.length === tokens.length &&
      grant.tokens.every((token, index) => token === tokens[index]),
  );
  if (duplicate) return;
  saveGrants([
    ...settingsDraft.supervision.grants,
    {
      id: `grant_${crypto.randomUUID()}`,
      target: "command_prefix",
      tokens,
      risk: "command",
    },
  ]);
  commandPrefix = "";
}

function removeGrant(id: string): void {
  saveGrants(
    settingsDraft.supervision.grants.filter((grant) => grant.id !== id),
  );
}

async function saveProjectGrants(grants: SupervisionGrant[]): Promise<void> {
  if (!activeProject || !updateProjectPermissions) return;
  const projectId = activeProject.id;
  projectPermissionsError = undefined;
  try {
    const saved = await updateProjectPermissions(projectId, {
      version: 1,
      grants,
    });
    if (activeProject?.id === projectId) projectPermissions = saved;
  } catch (error) {
    if (activeProject?.id === projectId) {
      projectPermissionsError =
        error instanceof Error ? error.message : String(error);
    }
  }
}

function addProjectCommandGrant(): void {
  const tokens = projectCommandPrefix.trim().split(/\s+/).filter(Boolean);
  if (!projectPermissions || tokens.length === 0 || tokens.length > 16) return;
  const duplicate = projectPermissions.grants.some(
    (grant) =>
      grant.target === "command_prefix" &&
      grant.tokens.length === tokens.length &&
      grant.tokens.every((token, index) => token === tokens[index]),
  );
  if (duplicate) return;
  void saveProjectGrants([
    ...projectPermissions.grants,
    {
      id: `grant_${crypto.randomUUID()}`,
      target: "command_prefix",
      tokens,
      risk: "command",
    },
  ]);
  projectCommandPrefix = "";
}

function removeProjectGrant(id: string): void {
  if (!projectPermissions) return;
  void saveProjectGrants(
    projectPermissions.grants.filter((grant) => grant.id !== id),
  );
}

function defaultOutcome(
  tool: ToolDescriptor,
  permission: Settings["defaultPermissionLevel"],
): string {
  if (permission === "autonomous") return "Allow";
  if (permission === "read_only")
    return tool.risk === "read" || tool.risk === "interaction"
      ? "Allow"
      : "Deny";
  if (tool.risk === "interaction") return "Allow";
  if (tool.risk === "read")
    return settingsDraft.defaultApprovalPolicy.autoApproveReadOnly
      ? "Allow"
      : "Ask";
  return "Ask";
}

function grantLabel(grant: SupervisionGrant): string {
  return grant.target === "tool" ? grant.toolName : grant.tokens.join(" ");
}
</script>

<SettingsSection id="defaults" title="Defaults">
  <SettingsGroup>
    <SettingsRow label="Default permission" layout="stacked">
      <SettingsChoiceCards
        items={permissionItems}
        variant="radio"
        value={settingsDraft.defaultPermissionLevel}
        ariaLabel="Default permission"
        tourId="setup-agent-default-permission"
        onValueChange={setDefaultPermission}
      />
    </SettingsRow>
    <SettingsToggleRow
      label="Auto-approve read-only tools in supervised mode"
      description="Let supervised agents inspect files, search, and read audited service data without prompting."
      checked={settingsDraft.defaultApprovalPolicy.autoApproveReadOnly}
      onCheckedChange={setAutoApproveReadOnly}
    />
  </SettingsGroup>
</SettingsSection>

<SettingsSection id="behavior" title="How permissions behave">
  <SettingsInlineMessage
    tone="info"
    text="Arguments can increase a tool's assessed risk. Hard planning and read-only constraints cannot be overridden."
  />
  {#if toolDescriptorsLoading}
    <p class="text-sm text-muted-foreground">Loading tool policy…</p>
  {:else}
    <SettingsList ariaLabel="Tool permission behavior">
      {#each toolDescriptors as tool (tool.name)}
        <SettingsSummaryRow
          title={tool.name}
          status={tool.risk === "destructive" ? "warning" : "muted"}
        >
          {#snippet meta()}
            Base risk: {tool.risk}{tool.argumentSensitive
              ? " · Arguments may change risk"
              : ""}
          {/snippet}
        </SettingsSummaryRow>
        <div class="grid gap-1 px-2 pb-2 sm:grid-cols-3">
          <SettingsKeyValueRow
            label="Read only"
            value={defaultOutcome(tool, "read_only")}
          />
          <SettingsKeyValueRow
            label="Supervised"
            value={defaultOutcome(tool, "supervised")}
          />
          <SettingsKeyValueRow
            label="Autonomous"
            value={defaultOutcome(tool, "autonomous")}
          />
        </div>
      {/each}
    </SettingsList>
  {/if}
</SettingsSection>

<SettingsSection
  id="project-allowed"
  title="Always allowed in the current project"
>
  {#if !activeProject}
    <SettingsInlineMessage
      tone="info"
      text="Open a project to manage project-scoped grants."
    />
  {:else}
    <SettingsInlineMessage
      tone="info"
      text={`These grants apply only to ${activeProject.name}. They are stored securely in ~/.nerve/projects/${activeProject.id}/permissions.json, outside the workspace.`}
    />
    <SettingsGroup>
      <SettingsRow
        label="Add project command prefix"
        description="Use an executable and optional subcommand, such as datadog logs read."
        layout="stacked"
      >
        <div class="flex gap-2">
          <Input
            bind:value={projectCommandPrefix}
            placeholder="datadog logs read"
            aria-label="Project command prefix"
            disabled={!projectPermissions}
            onkeydown={(event) => {
              if (event.key === "Enter") addProjectCommandGrant();
            }}
          />
          <Button
            variant="secondary"
            disabled={!projectPermissions || !projectCommandPrefix.trim()}
            onclick={addProjectCommandGrant}
          >
            <Plus class="size-4" />Add
          </Button>
        </div>
      </SettingsRow>
    </SettingsGroup>
    {#if projectPermissionsError}
      <SettingsInlineMessage tone="error" text={projectPermissionsError} />
    {:else if projectPermissionsLoading || !projectPermissions}
      <p class="text-sm text-muted-foreground">Loading project grants…</p>
    {:else if projectPermissions.grants.length === 0}
      <p class="text-sm text-muted-foreground">No project grants.</p>
    {:else}
      <SettingsList ariaLabel="Project always-allow grants">
        {#each projectPermissions.grants as grant (grant.id)}
          <SettingsSummaryRow title={grantLabel(grant)} status="ok">
            {#snippet meta()}
              {grant.target === "tool" ? "Tool" : "Command prefix"} · Risk {grant.risk}
              · This project
            {/snippet}
            {#snippet actions()}
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Remove ${grantLabel(grant)} project grant`}
                onclick={() => removeProjectGrant(grant.id)}
              >
                <Trash2 class="size-4" />
              </Button>
            {/snippet}
          </SettingsSummaryRow>
        {/each}
      </SettingsList>
    {/if}
  {/if}
</SettingsSection>

<SettingsSection id="always-allowed" title="Always allowed globally">
  <SettingsInlineMessage
    tone="warning"
    text="These grants apply to all projects. Permissions control prompts; they are not an operating-system sandbox."
  />
  <SettingsGroup>
    <SettingsRow
      label="Add command prefix"
      description="Use an executable and optional subcommand, such as datadog logs read."
      layout="stacked"
    >
      <div class="flex gap-2">
        <Input
          bind:value={commandPrefix}
          placeholder="datadog logs read"
          aria-label="Command prefix"
          onkeydown={(event) => {
            if (event.key === "Enter") addCommandGrant();
          }}
        />
        <Button
          variant="secondary"
          disabled={!commandPrefix.trim()}
          onclick={addCommandGrant}
        >
          <Plus class="size-4" />Add
        </Button>
      </div>
    </SettingsRow>
  </SettingsGroup>

  {#if settingsDraft.supervision.grants.length === 0}
    <p class="text-sm text-muted-foreground">No always-allow grants.</p>
  {:else}
    <SettingsList ariaLabel="Always-allow grants">
      {#each settingsDraft.supervision.grants as grant (grant.id)}
        <SettingsSummaryRow title={grantLabel(grant)} status="ok">
          {#snippet meta()}
            {grant.target === "tool" ? "Tool" : "Command prefix"} · Risk {grant.risk}
            · All projects
          {/snippet}
          {#snippet actions()}
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`Remove ${grantLabel(grant)} grant`}
              onclick={() => removeGrant(grant.id)}
            >
              <Trash2 class="size-4" />
            </Button>
          {/snippet}
        </SettingsSummaryRow>
      {/each}
    </SettingsList>
  {/if}
</SettingsSection>
