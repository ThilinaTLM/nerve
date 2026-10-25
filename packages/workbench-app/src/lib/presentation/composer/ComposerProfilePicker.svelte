<script lang="ts">
import Bot from "@lucide/svelte/icons/bot";
import ClipboardList from "@lucide/svelte/icons/clipboard-list";
import Network from "@lucide/svelte/icons/network";
import Code2 from "@lucide/svelte/icons/code-2";
import Popover, {
  PopoverBody,
  PopoverHeader,
  PopoverRow,
} from "@nervekit/ui-kit/components/composites/popover-panel";
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
const planning = $derived(agentProfile === "planning");
let open = $state(false);

function select(name: string) {
  if (name !== agentProfile) onChange?.(name);
  open = false;
}
</script>

{#if agentProfiles.length > 0}
  <Popover
    animateTriggerWidth
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
    <PopoverBody>
      {#each agentProfiles as profile (profile.name)}
        <PopoverRow
          label={profile.label}
          title={profile.description}
          selected={profile.name === agentProfile}
          disabled={controlsDisabled || disabled}
          onclick={() => select(profile.name)}
        />
      {/each}
    </PopoverBody>
  </Popover>
{/if}
