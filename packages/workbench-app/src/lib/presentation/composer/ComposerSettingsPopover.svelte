<script lang="ts">
import ChevronRight from "@lucide/svelte/icons/chevron-right";
import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
import SlidersHorizontal from "@lucide/svelte/icons/sliders-horizontal";
import type { Component } from "svelte";
import Popover, {
  PopoverBody,
  PopoverHeader,
  PopoverRow,
  PopoverViews,
} from "@nervekit/ui-kit/components/composites/popover-panel";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import type {
  PermissionRuleSetId,
  PermissionRuleSetSummary,
} from "@nervekit/contracts/permissions";
import type { ComposerAgentProfile } from "../conversations/conversation-view-contracts.js";
import { permissionIcon, profileIcon } from "./composer-icons";
import ComposerCapabilityPanel from "./ComposerCapabilityPanel.svelte";
import ComposerPermissionPanel from "./ComposerPermissionPanel.svelte";
import ComposerProfilePanel from "./ComposerProfilePanel.svelte";
import {
  ComposerCapabilities,
  type CapabilityKind,
  type ComposerCapabilityProps,
} from "./composer-capabilities.svelte.js";

/** Compact-toolbar overflow: profile, permissions and capabilities behind
 * one trigger, each drilling into the same panel its own toolbar control
 * opens on wider composers. */
type Props = {
  agentProfiles: ComposerAgentProfile[];
  agentProfile: string;
  profileDisabled?: boolean;
  controlsDisabled?: boolean;
  onAgentProfileChange?: (name: string) => void;
  activePermission: PermissionRuleSetSummary;
  permissionRuleSets: PermissionRuleSetSummary[];
  permissionLoading?: boolean;
  permissionError?: string;
  permissionLockedBy?: string;
  onPermissionChange?: (id: PermissionRuleSetId) => void;
  onRefreshPermissions?: () => void;
  onOpenPermissionSettings?: () => void;
  capability: ComposerCapabilityProps;
};

let props: Props = $props();

type View = "root" | "profile" | "permission" | CapabilityKind;
let open = $state(false);
let view = $state<View>("root");
const capabilities = new ComposerCapabilities(
  () => props.capability,
  () => (open = false),
);

const activeProfile = $derived(
  props.agentProfiles.find(
    (profile) => profile.name === props.agentProfile,
  ) ?? {
    name: props.agentProfile,
    label: props.agentProfile,
  },
);
const permissionChanged = $derived(props.activePermission.id !== "default");
const changed = $derived(capabilities.overrideCount > 0 || permissionChanged);
const ProfileIcon = $derived(profileIcon(props.agentProfile));
const PermissionIcon = $derived(permissionIcon(props.activePermission.id));

function back() {
  view = "root";
}
</script>

{#snippet navRow(
  label: string,
  Icon: Component<{ class?: string; "aria-hidden"?: "true" }>,
  value: string | undefined,
  target: View,
  options: { dot?: boolean; warn?: boolean; disabled?: boolean } = {},
)}
  <PopoverRow
    {label}
    disabled={options.disabled}
    onclick={() => (view = target)}
  >
    {#snippet icon()}
      <Icon
        class={`size-3.5 flex-none ${options.warn ? "text-warning" : "text-muted-foreground"}`}
        aria-hidden="true"
      />
    {/snippet}
    {#snippet trailing()}
      <span class="flex items-center gap-1.5">
        {#if options.dot}
          <span
            class="composer-badge-dot"
            role="img"
            aria-label="Changed for this conversation"
          ></span>
        {/if}
        {#if value}
          <span
            class={`max-w-[12rem] truncate ${options.warn ? "text-warning" : "text-muted-foreground"}`}
            >{value}</span
          >
        {/if}
        <ChevronRight
          class="size-3.5 flex-none text-muted-foreground"
          aria-hidden="true"
        />
      </span>
    {/snippet}
  </PopoverRow>
{/snippet}

<Popover
  bind:open
  onOpenChange={(next) => {
    if (next) view = "root";
  }}
  size="lg"
  triggerClass="composer-tab w-control p-0"
  ariaLabel="Conversation settings"
  triggerTitle="Conversation settings"
  side="top"
  align="start"
  presentation="adaptive"
>
  {#snippet trigger()}
    <span
      class={`relative inline-flex items-center ${props.controlsDisabled ? "opacity-60" : ""}`}
      data-tour-id="composer-settings"
    >
      <SlidersHorizontal aria-hidden="true" />
      {#if changed}
        <span
          class="composer-badge-dot absolute -top-1 -right-1.5"
          aria-hidden="true"
        ></span>
      {/if}
    </span>
  {/snippet}

  <PopoverViews key={view} direction={view === "root" ? "back" : "forward"}>
    {#if view === "root"}
      <PopoverHeader title="Conversation settings">
        {#snippet actions()}
          {#if capabilities.overrideCount > 0}
            <Button
              size="icon-sm"
              variant="ghost"
              ariaLabel="Reset all conversation capability overrides"
              title={`Reset all ${capabilities.overrideCount} conversation capability override${capabilities.overrideCount === 1 ? "" : "s"}`}
              disabled={props.capability.disabled || props.capability.loading}
              onclick={() => props.capability.onReset?.()}
            >
              <RotateCcw class="size-3.5" aria-hidden="true" />
            </Button>
          {/if}
        {/snippet}
      </PopoverHeader>
      <PopoverBody class="gap-0.5">
        {#if props.agentProfiles.length > 0}
          {@render navRow(
            "Agent profile",
            ProfileIcon,
            activeProfile.label,
            "profile",
          )}
        {/if}
        {@render navRow(
          "Permissions",
          PermissionIcon,
          props.activePermission.name,
          "permission",
          { warn: permissionChanged },
        )}
        {#each capabilities.sections as section (section.kind)}
          {@render navRow(
            section.title,
            section.icon,
            props.capability.error ? "Unavailable" : section.count,
            section.kind,
            { dot: capabilities.overrideCounts[section.kind] > 0 },
          )}
        {/each}
      </PopoverBody>
    {:else if view === "profile"}
      <ComposerProfilePanel
        agentProfiles={props.agentProfiles}
        agentProfile={props.agentProfile}
        disabled={props.controlsDisabled || props.profileDisabled}
        onBack={back}
        onSelect={(name) => {
          if (name !== props.agentProfile) props.onAgentProfileChange?.(name);
          back();
        }}
      />
    {:else if view === "permission"}
      <ComposerPermissionPanel
        activePermission={props.activePermission}
        permissionRuleSets={props.permissionRuleSets}
        loading={props.permissionLoading}
        error={props.permissionError}
        lockedBy={props.permissionLockedBy}
        disabled={props.controlsDisabled}
        onBack={back}
        onSelect={(id) => {
          if (id !== props.activePermission.id) props.onPermissionChange?.(id);
          back();
        }}
        onRefresh={props.onRefreshPermissions}
        onOpenSettings={() => {
          open = false;
          props.onOpenPermissionSettings?.();
        }}
      />
    {:else}
      <ComposerCapabilityPanel {capabilities} kind={view} onBack={back} />
    {/if}
  </PopoverViews>
</Popover>
