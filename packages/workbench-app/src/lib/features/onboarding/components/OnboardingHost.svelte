<script lang="ts">
import { responsive } from "$lib/app/shell/responsive.svelte";
import {
  agentDefaultsConfigured,
  agentDefaultsSummary,
  closeSetupGuide,
  considerAutomaticGuide,
  continueDeferredTour,
  currentSetupStep,
  currentTourStep,
  doNotShowAgain,
  finishProductTour,
  guideState,
  moveSetupGuide,
  moveTour,
  notNow,
  productTourCompleted,
  providerConfigured,
  scopedModelSummary,
  setupProgress,
  startProductTour,
  startSetupGuide,
  voiceConfigured,
} from "../guide-state.svelte.js";
import GuidedTourOverlay from "./GuidedTourOverlay.svelte";
import OnboardingDialog from "./OnboardingDialog.svelte";

$effect(() => {
  if (responsive.isPhone) return;
  considerAutomaticGuide();
  continueDeferredTour();
});

const tourStep = $derived(currentTourStep());
const setupStep = $derived(currentSetupStep());
const progress = $derived(setupProgress());
</script>

{#if !responsive.isPhone && guideState.mode === "setup"}
  <OnboardingDialog
    providerReady={providerConfigured()}
    voiceReady={voiceConfigured()}
    scopedModelsSummary={scopedModelSummary()}
    agentDefaultsReady={agentDefaultsConfigured()}
    agentDefaultsSummary={agentDefaultsSummary().text}
    productTourReady={productTourCompleted()}
    readyCount={progress.ready}
    totalCount={progress.total}
    onGuideProvider={() => startSetupGuide("provider")}
    onGuideVoice={() => startSetupGuide("voice")}
    onGuideScopedModels={() => startSetupGuide("scoped-models")}
    onGuideAgentDefaults={() => startSetupGuide("agent-defaults")}
    onStartTour={startProductTour}
    onDoNotShowAgain={doNotShowAgain}
    onNotNow={notNow}
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
    onComplete={finishProductTour}
    onClose={notNow}
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
    onComplete={closeSetupGuide}
    onClose={closeSetupGuide}
  />
{/if}
