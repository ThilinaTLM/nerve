<script lang="ts">
import { responsive } from "$lib/app/shell/responsive.svelte";
import { workspaceSelectors } from "$lib/application/workspace";
import {
  catalogGuides,
  closeActiveRun,
  considerAutomaticGuide,
  currentSetupStep,
  currentTourStep,
  finishActiveRun,
  guideState,
  later,
  markGuideCompleted,
  moveSetupGuide,
  moveTour,
  startGuide,
} from "../guide-state.svelte.js";
import GuideCatalogDialog from "./GuideCatalogDialog.svelte";
import GuidedTourOverlay from "./GuidedTourOverlay.svelte";

$effect(() => {
  if (responsive.isPhone) return;
  considerAutomaticGuide();
});

const tourStep = $derived(currentTourStep());
const setupStep = $derived(currentSetupStep());
const guides = $derived(catalogGuides());
</script>

{#if !responsive.isPhone && guideState.mode === "catalog"}
  <GuideCatalogDialog
    {guides}
    workbenchBlocked={!workspaceSelectors.activeProject}
    onStartGuide={startGuide}
    onMarkCompleted={markGuideCompleted}
    onLater={later}
  />
{:else if !responsive.isPhone && guideState.mode === "tour" && tourStep}
  <GuidedTourOverlay
    step={tourStep}
    variant="modal"
    index={guideState.stepIndex}
    count={guideState.runSteps.length}
    preparing={guideState.preparing}
    compact={responsive.isCompact}
    onBack={() => moveTour(-1)}
    onNext={() => moveTour(1)}
    onComplete={finishActiveRun}
    onClose={closeActiveRun}
  />
{:else if !responsive.isPhone && guideState.mode === "coach" && setupStep}
  <GuidedTourOverlay
    step={setupStep}
    variant="coach"
    index={guideState.setupStepIndex}
    count={guideState.setupSteps.length}
    preparing={guideState.preparing}
    compact={false}
    onBack={() => void moveSetupGuide(-1)}
    onNext={() => void moveSetupGuide(1)}
    onComplete={finishActiveRun}
    onClose={closeActiveRun}
  />
{/if}
