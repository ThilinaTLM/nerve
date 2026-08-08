<script lang="ts">
import { responsive } from "$lib/app/shell/responsive.svelte";
import {
  agentDefaultsConfigured,
  agentDefaultsSummary,
  completeGuide,
  considerAutomaticGuide,
  continueDeferredTour,
  currentTourStep,
  guideState,
  moveTour,
  notNow,
  pauseForAgentSettings,
  pauseForProviders,
  pauseForScopedModels,
  providerConfigured,
  scopedModelSummary,
  startProductTour,
  voiceConfigured,
} from "../guide-state.svelte.js";
import GuidedTourOverlay from "./GuidedTourOverlay.svelte";
import OnboardingDialog from "./OnboardingDialog.svelte";

$effect(() => {
  if (responsive.isPhone) return;
  considerAutomaticGuide();
  continueDeferredTour();
});

const step = $derived(currentTourStep());
</script>

{#if !responsive.isPhone && guideState.mode === "setup"}
  <OnboardingDialog
    providerReady={providerConfigured()}
    voiceReady={voiceConfigured()}
    scopedModelsSummary={scopedModelSummary()}
    agentDefaultsReady={agentDefaultsConfigured()}
    agentDefaultsSummary={agentDefaultsSummary().text}
    onOpenProviders={pauseForProviders}
    onOpenScopedModels={pauseForScopedModels}
    onOpenAgentSettings={pauseForAgentSettings}
    onStartTour={startProductTour}
    onComplete={completeGuide}
    onNotNow={notNow}
  />
{:else if !responsive.isPhone && guideState.mode === "tour" && step}
  <GuidedTourOverlay
    {step}
    index={guideState.stepIndex}
    count={guideState.runSteps.length}
    targetAvailable={guideState.targetAvailable}
    preparing={guideState.preparing}
    compact={responsive.isCompact}
    onBack={() => moveTour(-1)}
    onNext={() => moveTour(1)}
    onComplete={completeGuide}
    onNotNow={notNow}
  />
{/if}
