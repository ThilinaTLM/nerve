<script lang="ts">
import Bot from "@lucide/svelte/icons/bot";
import ClipboardList from "@lucide/svelte/icons/clipboard-list";
import Network from "@lucide/svelte/icons/network";
import Code2 from "@lucide/svelte/icons/code-2";
import Popover, {
  PopoverHeader,
  PopoverCommandList,
} from "@nervekit/ui-kit/components/composites/popover-panel";
import { composerProfileItems } from "./composer-profile-items.js";
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

const active = $derived(
  agentProfiles.find((profile) => profile.name === agentProfile) ?? {
    name: agentProfile,
    label: agentProfile,
  },
);
const profileItems = $derived(composerProfileItems(agentProfiles));
const planning = $derived(agentProfile === "planning");
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
    size="sm"
    triggerClass="composer-tab"
    ariaLabel="Agent profile"
    triggerTitle={shortcut && !disabled
      ? `Agent profile: ${active.label} (${shortcut})`
      : `Agent profile: ${active.label}`}
    triggerAriaKeyShortcuts={shortcutAria}
    side="top"
    align="start"
  >
    {#snippet trigger()}
      <span
        class={`inline-flex items-center gap-1 ${disabled ? "opacity-60" : ""}`}
        data-tour-id="composer-profile"
      >
        {#if planning}
          <ClipboardList aria-hidden="true" />
        {:else if agentProfile === "coding"}
          <Code2 aria-hidden="true" />
        {:else if agentProfile === "lead"}
          <Network aria-hidden="true" />
        {:else}
          <Bot aria-hidden="true" />
        {/if}
        <span class="@max-[500px]/composer-toolbar:hidden">{active.label}</span>
      </span>
    {/snippet}
    <PopoverHeader title="Agent profile" />
    <PopoverCommandList
      items={profileItems}
      ariaLabel="Agent profiles"
      placeholder="Search profiles"
      isSelected={(profile) => profile.name === agentProfile}
      isDisabled={() => controlsDisabled || disabled}
      onChoose={(profile) => select(profile.name)}
    />
  </Popover>
{/if}
