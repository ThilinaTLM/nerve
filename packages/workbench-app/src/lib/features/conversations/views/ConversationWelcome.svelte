<script lang="ts">
import { ConversationSignal, conversationStarters } from "$lib/presentation";

let {
  onNewChat,
  projectSelected = false,
  projectLabel,
  projectPath,
  availableProfiles,
  defaultProfile,
}: {
  onNewChat: (profile: string) => void;
  projectSelected?: boolean;
  projectLabel?: string;
  projectPath?: string;
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
  {starters}
  defaultStarter={defaultProfile}
  startersDisabled={!projectSelected}
  onSelectStarter={(starter) => onNewChat(starter.profile)}
/>
