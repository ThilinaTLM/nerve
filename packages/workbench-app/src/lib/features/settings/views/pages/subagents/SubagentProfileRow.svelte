<script lang="ts">
import ChevronRight from "@lucide/svelte/icons/chevron-right";
import Ellipsis from "@lucide/svelte/icons/ellipsis";
import type { ModelInfo } from "@nervekit/contracts/models";
import type {
  SubagentProfileConfiguration,
  SubagentProfileDiagnostic,
  SubagentProfileScope,
} from "@nervekit/contracts/subagents";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { buttonVariants } from "@nervekit/ui-kit/components/ui/button";
import * as DropdownMenu from "@nervekit/ui-kit/components/ui/dropdown-menu";
import { Switch } from "@nervekit/ui-kit/components/ui/switch";
import { cn } from "@nervekit/ui-kit/utils";
import {
  profileCustomizedFields,
  profileDescription,
  profileFieldLabel,
  profileLabel,
  profileLayerDotClasses,
  profileLayerLabels,
  profileSummaryParts,
} from "$lib/presentation/subagents/profile-layers";
import ProfileDiagnosticMessage from "./ProfileDiagnosticMessage.svelte";
import {
  profileRowActions,
  profileRowProblems,
  type ProfileSettingsLayer,
} from "./subagent-profile-rows";

type Props = {
  profile: SubagentProfileConfiguration;
  scope: SubagentProfileScope;
  models: readonly ModelInfo[];
  documentDiagnostics: readonly SubagentProfileDiagnostic[];
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
  models,
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
const actions = $derived(
  profileRowActions(profile, scope, { canCopyToProject }),
);
const meta = $derived(
  effective ? profileSummaryParts(effective, models).join(" · ") : undefined,
);
const destructiveActions = $derived(
  actions.resetCustomizations || actions.delete,
);
</script>

<!-- The title button stretches over the row, so the row opens on click while
  the switch and menu stay separate, focusable controls above it. -->
<div
  role="listitem"
  class="relative grid gap-1 px-3 py-2 transition-colors hover:bg-accent/40"
>
  <div class="flex min-w-0 items-center gap-3">
    <div
      class={cn(
        "grid min-w-0 flex-1 gap-0.5",
        effective && !enabled && "opacity-60",
      )}
    >
      <div class="flex min-w-0 flex-wrap items-center gap-1.5">
        {#if actions.edit}
          <button
            type="button"
            class="max-w-full truncate rounded-sm text-left text-sm text-foreground outline-none after:absolute after:inset-0 after:rounded-sm focus-visible:after:ring-2 focus-visible:after:ring-ring/50"
            aria-label={`Edit ${label}`}
            onclick={onOpen}>{label}</button
          >
        {:else}
          <span class="max-w-full truncate text-sm text-foreground"
            >{label}</span
          >
        {/if}
        {#if customized.length}
          <Badge
            variant="neutral"
            title={`Changed here: ${customized.map(profileFieldLabel).join(", ")}`}
          >
            <span
              class={cn("size-1.5 rounded-full", profileLayerDotClasses[scope])}
              aria-hidden="true"
            ></span>Customized here
          </Badge>
        {/if}
        {#if problems.blocked}
          <Badge variant="destructive">Can't be used</Badge>
        {:else if problems.reduced}
          <Badge variant="warning">Reduced capabilities</Badge>
        {/if}
        {#if problems.needsReview}
          <Badge variant="warning">Needs review</Badge>
        {/if}
      </div>
      {#if description}
        <p class="truncate text-xs text-muted-foreground">{description}</p>
      {/if}
      {#if meta}
        <p class="truncate text-xs text-muted-foreground">{meta}</p>
      {/if}
    </div>

    <div class="flex flex-none items-center gap-1.5">
      {#if effective}
        <Switch
          class="relative"
          checked={enabled}
          disabled={busy}
          aria-label={`${label} available in ${profileLayerLabels[scope]}`}
          onCheckedChange={onEnabledChange}
        />
      {/if}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          class={cn(
            buttonVariants({ variant: "ghost", size: "icon-sm" }),
            "relative",
          )}
          aria-label={`${label} actions`}
          title={`${label} actions`}
          disabled={busy}
        >
          <Ellipsis class="size-3.5" aria-hidden="true" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end" class="w-56">
          {#if actions.edit}
            <DropdownMenu.Item onSelect={onOpen}>Edit…</DropdownMenu.Item>
          {/if}
          {#if actions.duplicate}
            <DropdownMenu.Item onSelect={onDuplicate}
              >Duplicate as new profile…</DropdownMenu.Item
            >
          {/if}
          {#if actions.copyTo}
            {@const target = actions.copyTo}
            <DropdownMenu.Item onSelect={() => onCopy(target)}
              >Copy to {target === "project"
                ? "project"
                : "user"}</DropdownMenu.Item
            >
          {/if}
          {#if actions.exportJson}
            <DropdownMenu.Item onSelect={onExport}
              >Export as JSON</DropdownMenu.Item
            >
          {/if}
          {#if destructiveActions}
            <DropdownMenu.Separator />
            {#if actions.resetCustomizations}
              <DropdownMenu.Item onSelect={onResetCustomizations}
                >Reset customizations…</DropdownMenu.Item
              >
            {/if}
            {#if actions.delete}
              <DropdownMenu.Item variant="destructive" onSelect={onDelete}
                >Delete profile…</DropdownMenu.Item
              >
            {/if}
          {/if}
        </DropdownMenu.Content>
      </DropdownMenu.Root>
      {#if actions.edit}
        <ChevronRight
          class="pointer-events-none size-4 text-muted-foreground"
          aria-hidden="true"
        />
      {/if}
    </div>
  </div>

  {#if problems.documentBlock || problems.diagnostics.length}
    <div class="relative grid min-w-0 gap-1">
      {#if problems.documentBlock}
        <p class="text-xs text-destructive break-words">
          {problems.documentBlock}
        </p>
      {/if}
      {#each problems.diagnostics as diagnostic, index (index)}
        <ProfileDiagnosticMessage {diagnostic} tinted />
      {/each}
    </div>
  {/if}
</div>
