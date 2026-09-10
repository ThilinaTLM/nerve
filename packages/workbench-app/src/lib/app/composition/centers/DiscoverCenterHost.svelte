<script lang="ts">
import { openSettingsPane } from "$lib/application/settings";
import { workspaceSelectors } from "$lib/application/workspace";
import {
  DiscoverView,
  discoverPageModel,
  markDiscoverSeen,
  setDiscoverAutoOpen,
  type DiscoverAction,
} from "$lib/app/discover";
import { markGuideCompleted, startGuide } from "$lib/app/discover/guides";

const model = $derived(discoverPageModel());
$effect(() => {
  markDiscoverSeen();
});

function handleAction(action: DiscoverAction): void {
  if (action.kind === "guide") {
    startGuide(action.guideId);
    return;
  }
  if (action.kind === "settings")
    void openSettingsPane(action.pageId, action.sectionId);
}
</script>

<DiscoverView
  {model}
  workbenchBlocked={!workspaceSelectors.activeProject}
  onStartGuide={startGuide}
  onMarkCompleted={markGuideCompleted}
  onAction={handleAction}
  onSetAutoOpen={setDiscoverAutoOpen}
/>
