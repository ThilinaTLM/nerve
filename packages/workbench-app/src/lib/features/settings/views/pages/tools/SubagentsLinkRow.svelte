<script lang="ts">
import ChevronRight from "@lucide/svelte/icons/chevron-right";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { openSettingsPane } from "$lib/application/settings";
import { SettingsListItem } from "$lib/presentation/settings";
</script>

<SettingsListItem
  title="Sub-agents"
  description="Delegate work to sub-agents with their own profiles. Profiles, models and permissions are configured on the Sub-agents page."
>
  {#snippet actions()}
    <Button
      size="xs"
      variant="outline"
      onclick={() => void openSettingsPane("subagents")}
    >
      Open Sub-agents
      <ChevronRight class="size-3.5" aria-hidden="true" />
    </Button>
  {/snippet}
</SettingsListItem>
