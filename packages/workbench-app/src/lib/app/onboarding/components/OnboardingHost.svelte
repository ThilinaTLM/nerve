<script lang="ts">
import { responsive } from "$lib/app/shell/responsive.svelte";
import {
  closeActiveRun,
  currentSetupStep,
  currentTourStep,
  finishActiveRun,
  guideState,
  moveSetupGuide,
  moveTour,
} from "../guide-state.svelte.js";
import { considerAutomaticDiscover } from "../discover-state.svelte.js";
import GuidedTourOverlay from "./GuidedTourOverlay.svelte";

$effect(() => {
  if (responsive.isPhone) return;
  considerAutomaticDiscover();
});

const tourStep = $derived(currentTourStep());
const setupStep = $derived(currentSetupStep());
</script>

{#if !responsive.isPhone && guideState.mode === "tour" && tourStep}
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
