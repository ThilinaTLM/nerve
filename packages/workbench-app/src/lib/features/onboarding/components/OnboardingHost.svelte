<script lang="ts">
import { responsive } from "$lib/app/shell/responsive.svelte";
import { workspaceSelectors } from "$lib/features/workspace";
import {
  catalogGuides,
  closeActiveRun,
  considerAutomaticGuide,
  currentCatalogGuide,
  currentSetupStep,
  currentTourStep,
  finishActiveRun,
  guideState,
  guideSummary,
  later,
  markGuideCompleted,
  moveCatalog,
  moveSetupGuide,
  moveTour,
  startCurrentGuide,
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
const currentGuide = $derived(currentCatalogGuide());
</script>

{#if !responsive.isPhone && guideState.mode === "catalog" && currentGuide}
  <GuideCatalogDialog
    guide={currentGuide}
    summary={guideSummary(currentGuide.id)}
    index={guideState.selectedGuideIndex}
    count={guides.length}
    workbenchBlocked={!workspaceSelectors.activeProject}
    onBack={() => moveCatalog(-1)}
    onNext={() => moveCatalog(1)}
    onStart={startCurrentGuide}
    onMarkCompleted={() => markGuideCompleted(currentGuide.id)}
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
