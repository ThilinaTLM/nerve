<script lang="ts">
import type { Mode } from "@nervekit/contracts";
import {
  ConversationSignal,
  conversationStarters,
  type ConversationStarter,
} from "$lib/presentation";

let {
  onNewChat,
  projectSelected = false,
  projectLabel,
  projectPath,
}: {
  onNewChat: (mode: Mode) => void;
  projectSelected?: boolean;
  projectLabel?: string;
  projectPath?: string;
} = $props();

function startWith(starter: ConversationStarter) {
  onNewChat(starter.mode);
}
</script>

<ConversationSignal
  variant="launchpad"
  title="Let's give this repo a plot twist."
  message={projectSelected
    ? "Plot the move, or dive straight into the code."
    : "Bring a project. We'll bring the momentum."}
  {projectLabel}
  {projectPath}
  starters={conversationStarters}
  startersDisabled={!projectSelected}
  onSelectStarter={startWith}
/>
