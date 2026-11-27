<script lang="ts">
import Plus from "@lucide/svelte/icons/plus";
import { LevelMenu } from "$lib/presentation/settings";
import { profilesPageState } from "./profiles-page-state.svelte";
import { profileKindForPage } from "./profile-kind";

/** The header action of the Agents and Sub-agents lists. */
let { pageId }: { pageId: string } = $props();
</script>

<LevelMenu
  label="New profile"
  icon={Plus}
  projectName={profilesPageState.projectName}
  onSelect={(layer) =>
    (profilesPageState.newProfile = {
      kind: profileKindForPage(pageId),
      layer,
    })}
/>
