<script lang="ts">
import type { Snippet } from "svelte";
import { ConversationSignal, conversationStarters } from "$lib/presentation";

let {
  onNewChat,
  projectSelected = false,
  projectLabel,
  projectPath,
  projectIcon,
  availableProfiles,
  defaultProfile,
}: {
  onNewChat: (profile: string) => void;
  projectSelected?: boolean;
  projectLabel?: string;
  projectPath?: string;
  /** Replaces the folder glyph beside the project label. */
  projectIcon?: Snippet;
  /** Selectable lead profile names; all starters show until they load. */
  availableProfiles?: readonly string[];
  defaultProfile?: string;
} = $props();

const starters = $derived(
  availableProfiles?.length
    ? conversationStarters.filter((starter) =>
        availableProfiles.includes(starter.profile),
      )
    : conversationStarters,
);
</script>

<ConversationSignal
  variant="launchpad"
  title="Let's give this repo a plot twist."
  message={projectSelected
    ? "Pick how you want to work."
    : "Bring a project. We'll bring the momentum."}
  {projectLabel}
  {projectPath}
  {projectIcon}
  {starters}
  defaultStarter={defaultProfile}
  startersDisabled={!projectSelected}
  onSelectStarter={(starter) => onNewChat(starter.profile)}
/>
