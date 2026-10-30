<script lang="ts">
import { profileIcon } from "./composer-icons";
import Popover from "@nervekit/ui-kit/components/composites/popover-panel";
import ComposerProfilePanel from "./ComposerProfilePanel.svelte";
import type { ComposerAgentProfile } from "../conversations/conversation-view-contracts.js";

type Props = {
  /** Profiles offered by the selector; an empty list drops it entirely. */
  agentProfiles: ComposerAgentProfile[];
  agentProfile: string;
  /** Read-only: shows the profile without offering a switch. */
  disabled?: boolean;
  controlsDisabled?: boolean;
  shortcut?: string;
  shortcutAria?: string;
  onChange?: (name: string) => void;
};

let {
  agentProfiles,
  agentProfile,
  disabled = false,
  controlsDisabled = false,
  shortcut,
  shortcutAria,
  onChange,
}: Props = $props();
const ActiveProfileIcon = $derived(profileIcon(agentProfile));

const active = $derived(
  agentProfiles.find((profile) => profile.name === agentProfile) ?? {
    name: agentProfile,
    label: agentProfile,
  },
);
let open = $state(false);

function select(name: string) {
  if (name !== agentProfile) onChange?.(name);
  open = false;
}
</script>

{#if agentProfiles.length > 0}
  <Popover
    triggerWidthKey={agentProfiles.some(
      (profile) => profile.name === agentProfile,
    )
      ? `${agentProfile}:${active.label}`
      : null}
    bind:open
    size="lg"
    triggerClass="composer-tab"
    ariaLabel="Agent profile"
    triggerTitle={shortcut && !disabled
      ? `Agent profile: ${active.label} (${shortcut})`
      : `Agent profile: ${active.label}`}
    triggerAriaKeyShortcuts={shortcutAria}
    side="top"
    align="start"
    presentation="adaptive"
  >
    {#snippet trigger()}
      <span
        class={`inline-flex items-center gap-1 ${disabled ? "opacity-60" : ""}`}
        data-tour-id="composer-profile"
      >
        <ActiveProfileIcon aria-hidden="true" />
        <span class="@max-[500px]/composer-toolbar:hidden">{active.label}</span>
      </span>
    {/snippet}
    <ComposerProfilePanel
      {agentProfiles}
      {agentProfile}
      disabled={controlsDisabled || disabled}
      onSelect={select}
    />
  </Popover>
{/if}
