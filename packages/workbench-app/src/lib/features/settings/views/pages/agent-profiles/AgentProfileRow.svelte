<script lang="ts">
import Ellipsis from "@lucide/svelte/icons/ellipsis";
import type {
  AgentProfileConfiguration,
  AgentProfileDiagnostic,
  AgentProfileScope,
} from "@nervekit/contracts/agent-profiles";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { buttonVariants } from "@nervekit/ui-kit/components/ui/button";
import * as DropdownMenu from "@nervekit/ui-kit/components/ui/dropdown-menu";
import { Switch } from "@nervekit/ui-kit/components/ui/switch";
import { SettingsDisclosureItem } from "$lib/presentation/settings";
import {
  profileCustomizedFields,
  profileDescription,
  profileFieldLabel,
  profileLabel,
  profileLayerLabels,
} from "$lib/presentation/agent-profiles/profile-layers";
import ToolConfigureButton from "../tools/ToolConfigureButton.svelte";
import ProfileDiagnosticMessage from "./ProfileDiagnosticMessage.svelte";
import {
  profileRowActions,
  profileRowProblems,
  type ProfileSettingsLayer,
} from "./agent-profile-rows";

type Props = {
  profile: AgentProfileConfiguration;
  scope: AgentProfileScope;
  /** The collapsed line: model, permission, tool and skill counts. */
  summary?: string;
  documentDiagnostics: readonly AgentProfileDiagnostic[];
  busy?: boolean;
  /** An active project exists to copy user profiles into. */
  canCopyToProject?: boolean;
  onOpen: () => void;
  onEnabledChange: (enabled: boolean) => void;
  onDuplicate: () => void;
  onCopy: (target: ProfileSettingsLayer) => void;
  onExport: () => void;
  onResetCustomizations: () => void;
  onDelete: () => void;
};

let {
  profile,
  scope,
  summary,
  documentDiagnostics,
  busy = false,
  canCopyToProject = false,
  onOpen,
  onEnabledChange,
  onDuplicate,
  onCopy,
  onExport,
  onResetCustomizations,
  onDelete,
}: Props = $props();

const label = $derived(profileLabel(profile));
const description = $derived(profileDescription(profile));
const effective = $derived(profile.effective);
const enabled = $derived(effective?.enabled ?? false);
const customized = $derived(profileCustomizedFields(profile, scope));
const problems = $derived(
  profileRowProblems(profile, documentDiagnostics, scope),
);
const rowActions = $derived(
  profileRowActions(profile, scope, { canCopyToProject }),
);
const destructiveActions = $derived(
  rowActions.resetCustomizations || rowActions.delete,
);
</script>

<SettingsDisclosureItem title={label} description={summary}>
  {#snippet badges()}
    {#if customized.length}
      <Badge
        variant="neutral"
        title={`Changed here: ${customized.map(profileFieldLabel).join(", ")}`}
        >Customized</Badge
      >
    {/if}
    {#if problems.blocked}
      <Badge variant="destructive">Can't be used</Badge>
    {:else if problems.reduced}
      <Badge variant="warning">Reduced capabilities</Badge>
    {/if}
    {#if problems.needsReview}
      <Badge variant="warning">Needs review</Badge>
    {/if}
  {/snippet}
  {#snippet actions()}
    {#if rowActions.edit}
      <ToolConfigureButton label={`Configure ${label}`} onclick={onOpen} />
    {/if}
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        class={buttonVariants({ variant: "ghost", size: "icon-sm" })}
        aria-label={`${label} actions`}
        title={`${label} actions`}
        disabled={busy}
      >
        <Ellipsis class="size-3.5" aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end" class="w-56">
        {#if rowActions.duplicate}
          <DropdownMenu.Item onSelect={onDuplicate}
            >Duplicate as new profile</DropdownMenu.Item
          >
        {/if}
        {#if rowActions.copyTo}
          {@const target = rowActions.copyTo}
          <DropdownMenu.Item onSelect={() => onCopy(target)}
            >Copy to {target === "project"
              ? "project"
              : "user"}</DropdownMenu.Item
          >
        {/if}
        {#if rowActions.exportJson}
          <DropdownMenu.Item onSelect={onExport}
            >Export as JSON</DropdownMenu.Item
          >
        {/if}
        {#if destructiveActions}
          <DropdownMenu.Separator />
          {#if rowActions.resetCustomizations}
            <DropdownMenu.Item onSelect={onResetCustomizations}
              >Reset customizations</DropdownMenu.Item
            >
          {/if}
          {#if rowActions.delete}
            <DropdownMenu.Item variant="destructive" onSelect={onDelete}
              >Delete profile</DropdownMenu.Item
            >
          {/if}
        {/if}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
    {#if effective}
      <Switch
        checked={enabled}
        disabled={busy}
        aria-label={`${label} available in ${profileLayerLabels[scope]}`}
        onCheckedChange={onEnabledChange}
      />
    {/if}
  {/snippet}
  {#snippet detail()}
    {#if description}
      <p class="break-words">{description}</p>
    {/if}
    {#if problems.documentBlock}
      <p class="break-words text-destructive">{problems.documentBlock}</p>
    {/if}
    {#each problems.diagnostics as diagnostic, index (index)}
      <ProfileDiagnosticMessage {diagnostic} tinted />
    {/each}
  {/snippet}
</SettingsDisclosureItem>
