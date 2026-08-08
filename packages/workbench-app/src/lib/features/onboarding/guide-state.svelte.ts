import { tick } from "svelte";
import { workbenchStartupState } from "$lib/core/startup/workbench-startup-state.svelte";
import { openAuthPane } from "$lib/features/auth";
import { hasChatGptAudioAuth } from "$lib/features/audio";
import { conversationSelectors } from "$lib/features/conversations";
import { openConversationHistory } from "$lib/features/conversations/state/composer-signals.svelte";
import { settingsState } from "$lib/features/settings/state/settings-state.svelte";
import {
  openSettingsPane,
  queueSettingsSave,
} from "$lib/features/settings/state/settings-actions.svelte";
import {
  captureCenterTabsPresentation,
  restoreCenterTabsPresentation,
  type CenterTabsPresentationSnapshot,
} from "$lib/features/workspace/state/center-tabs.svelte";
import { workspaceSelectors } from "$lib/features/workspace";
import { newConversation } from "$lib/features/workspace/state/workspace-actions.svelte";
import { workspaceState } from "$lib/features/workspace/state/workspace-state.svelte";
import {
  captureShellPresentation,
  restoreShellPresentation,
  revealPanelViewTemporarily,
  type ShellPresentationSnapshot,
} from "$lib/app/shell/shell-layout.svelte";
import { responsive } from "$lib/app/shell/responsive.svelte";
import {
  CURRENT_ONBOARDING_VERSION,
  CURRENT_PRODUCT_TOUR_VERSION,
  guideItemsForRun,
  tourSteps,
  type TourStep,
} from "./guide-content.js";
import { adjacentStep, shouldAutoOpenGuide } from "./guide-controller.js";
import {
  readProductTourCompletionVersion,
  writeProductTourCompletionVersion,
} from "./product-tour-completion.js";
import { setupStepsForArea, adjacentSetupStep } from "./setup-guide-policy.js";
import type { SetupGuideArea, SetupGuideStep } from "./setup-guide-content.js";
import {
  calculateSetupProgress,
  type SetupProgress,
} from "./setup-progress.js";
import {
  summarizeAgentDefaults,
  type AgentDefaultsSetupSummary,
} from "./setup-summary.js";
import {
  activeTabIsConversation,
  deferredTourCanContinue,
  needsProjectForTour,
} from "./tour-readiness.js";

type GuideMode = "closed" | "setup" | "paused" | "tour" | "coach";

type PresentationSnapshot = {
  shell: ShellPresentationSnapshot;
  tabs: CenterTabsPresentationSnapshot;
  settingsPageId: string;
  settingsSectionId: string;
  historyOpen: boolean;
};

export const guideState = $state({
  mode: "closed" as GuideMode,
  manual: false,
  stepIndex: 0,
  consideredGeneration: undefined as number | undefined,
  preparing: false,
  targetAvailable: false,
  awaitingProject: false,
  runSteps: [] as TourStep[],
  setupArea: undefined as SetupGuideArea | undefined,
  setupSteps: [] as SetupGuideStep[],
  setupStepIndex: 0,
  completedProductTourVersion: readProductTourCompletionVersion(),
});

let presentationSnapshot: PresentationSnapshot | undefined;
let preparationId = 0;

export function completedOnboardingVersion(): number {
  return settingsState.settingsDraft?.ui.onboardingVersion ?? 0;
}

export function completedProductTourVersion(): number {
  return guideState.completedProductTourVersion;
}

export function guideUnseen(): boolean {
  return completedOnboardingVersion() < CURRENT_ONBOARDING_VERSION;
}

export function productTourCompleted(): boolean {
  return completedProductTourVersion() >= CURRENT_PRODUCT_TOUR_VERSION;
}

export function providerConfigured(): boolean {
  return settingsState.authProviders.some((provider) => provider.configured);
}

export function voiceConfigured(): boolean {
  return hasChatGptAudioAuth(settingsState.authProviders);
}

export function scopedModelSummary(): string {
  const count = settingsState.settingsDraft?.scopedModels.length ?? 0;
  if (count === 0) return "All authenticated models are available";
  return `${count} scoped ${count === 1 ? "model" : "models"} selected`;
}

export function agentDefaultsSummary(): AgentDefaultsSetupSummary {
  const draft = settingsState.settingsDraft;
  if (!draft) return { configured: false, text: "Agent defaults are loading." };
  return summarizeAgentDefaults(draft, settingsState.models);
}

export function agentDefaultsConfigured(): boolean {
  return agentDefaultsSummary().configured;
}

export function setupProgress(): SetupProgress {
  return calculateSetupProgress({
    providerReady: providerConfigured(),
    voiceReady: voiceConfigured(),
    scopedModelsValid: Boolean(settingsState.settingsDraft),
    agentDefaultsReady: agentDefaultsConfigured(),
    productTourCompleted: productTourCompleted(),
  });
}

export function setupPaused(): boolean {
  return guideState.mode === "paused" || guideState.mode === "coach";
}

export function considerAutomaticGuide(): void {
  const generation = workbenchStartupState.generation;
  if (
    !shouldAutoOpenGuide({
      progressiveActive: workbenchStartupState.progressiveActive,
      settingsLoaded: Boolean(settingsState.settingsDraft),
      completedVersion: completedOnboardingVersion(),
      currentVersion: CURRENT_ONBOARDING_VERSION,
      generation,
      consideredGeneration: guideState.consideredGeneration,
    })
  )
    return;
  guideState.consideredGeneration = generation;
  guideState.manual = false;
  guideState.mode = "setup";
  guideState.stepIndex = 0;
}

export function openGuide(): void {
  guideState.awaitingProject = false;
  guideState.manual = true;
  guideState.mode = "setup";
}

function capturePresentation(): PresentationSnapshot {
  return {
    shell: captureShellPresentation(),
    tabs: captureCenterTabsPresentation(),
    settingsPageId: settingsState.activePageId,
    settingsSectionId: settingsState.activeSectionId,
    historyOpen: Boolean(
      document.querySelector('[data-tour-id="conversation-history"]'),
    ),
  };
}

function closeConversationHistory(): void {
  document
    .querySelector<HTMLElement>('[data-tour-id="conversation-history"]')
    ?.closest<HTMLElement>('[data-slot="dialog-content"]')
    ?.querySelector<HTMLButtonElement>('[aria-label="Close dialog"]')
    ?.click();
}

function restorePresentation(): void {
  const snapshot = presentationSnapshot;
  presentationSnapshot = undefined;
  if (!snapshot) return;
  restoreShellPresentation(snapshot.shell);
  restoreCenterTabsPresentation(snapshot.tabs);
  settingsState.activePageId = snapshot.settingsPageId;
  settingsState.activeSectionId = snapshot.settingsSectionId;
  if (!snapshot.historyOpen) closeConversationHistory();
}

function visibleTarget(targetId?: string): HTMLElement | undefined {
  if (!targetId) return undefined;
  return [
    ...document.querySelectorAll<HTMLElement>(`[data-tour-id="${targetId}"]`),
  ].find((element) => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
}

export function currentTourStep(): TourStep | undefined {
  return guideState.runSteps[guideState.stepIndex];
}

export function currentSetupStep(): SetupGuideStep | undefined {
  return guideState.setupSteps[guideState.setupStepIndex];
}

const tourPanelViewByStep: Partial<Record<TourStep["id"], string>> = {
  conversations: "conversations",
  "panel-new-conversation": "conversations",
  git: "git",
  "pull-requests": "pull-requests",
  tasks: "tasks",
  files: "files",
  "scratch-notes": "notes",
  "context-panel": "context",
};

async function settlePreparation(): Promise<void> {
  await tick();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

async function prepareTourStep(step: TourStep): Promise<void> {
  const requestId = ++preparationId;
  guideState.preparing = true;
  guideState.targetAvailable = false;
  if (step.id !== "history") closeConversationHistory();
  const panelView = tourPanelViewByStep[step.id];
  if (panelView) revealPanelViewTemporarily(panelView, responsive.isCompact);
  else if (step.id === "composer") {
    if (!activeTabIsConversation(workspaceSelectors.activeCenterTab?.kind)) {
      newConversation();
      await tick();
    }
  } else if (step.id === "history") {
    if (conversationSelectors.activeConversation) openConversationHistory();
  }
  await settlePreparation();
  if (requestId !== preparationId || guideState.mode !== "tour") return;
  guideState.targetAvailable = Boolean(visibleTarget(step.targetId));
  guideState.preparing = false;
}

async function waitForVisibleTarget(
  targetId: string,
  timeoutMs: number,
): Promise<HTMLElement | undefined> {
  const deadline = performance.now() + timeoutMs;
  do {
    const target = visibleTarget(targetId);
    if (target) return target;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
  } while (performance.now() < deadline);
  return undefined;
}

async function prepareSetupStep(
  step: SetupGuideStep,
  enterCoach = false,
): Promise<void> {
  const requestId = ++preparationId;
  guideState.preparing = true;
  guideState.targetAvailable = false;
  let target = visibleTarget(step.targetId);
  const preparation = step.preparation;

  // Navigate only before the coach appears. Re-selecting a center tab during
  // later steps remounts its page and closes interactive dialogs (for example,
  // the scoped-model catalog) before their controls can be highlighted.
  if (enterCoach && !target && preparation?.kind === "auth") {
    await openAuthPane(preparation.pageId, preparation.sectionId);
  } else if (enterCoach && !target && preparation?.kind === "settings") {
    await openSettingsPane(preparation.pageId, preparation.sectionId);
  }

  await settlePreparation();
  // Initial tab navigation may need to finish loading remote data and mount a
  // center-tab shell. Conditional follow-up targets get a short grace period
  // because they depend on an action the user may intentionally skip.
  target = await waitForVisibleTarget(step.targetId, enterCoach ? 3_000 : 150);
  if (
    requestId !== preparationId ||
    !["paused", "coach"].includes(guideState.mode)
  )
    return;

  target?.scrollIntoView({
    behavior: "instant",
    block: "nearest",
    inline: "nearest",
  });
  await settlePreparation();
  if (
    requestId !== preparationId ||
    !["paused", "coach"].includes(guideState.mode)
  )
    return;

  if (enterCoach) guideState.mode = "coach";
  guideState.targetAvailable = Boolean(visibleTarget(step.targetId));
  guideState.preparing = false;
}

export function startSetupGuide(area: SetupGuideArea): void {
  guideState.setupArea = area;
  guideState.setupSteps = setupStepsForArea(area, {
    codexConnected: voiceConfigured(),
  });
  guideState.setupStepIndex = 0;
  guideState.mode = "paused";
  const step = currentSetupStep();
  if (step) void prepareSetupStep(step, true);
}

export async function moveSetupGuide(direction: -1 | 1): Promise<void> {
  const current = currentSetupStep();
  const nextIndex = adjacentSetupStep(
    guideState.setupStepIndex,
    guideState.setupSteps.length,
    direction,
  );
  if (nextIndex === guideState.setupStepIndex) return;
  const next = guideState.setupSteps[nextIndex];

  // Some steps teach the action that opens the UI needed by the following
  // step. Advancing performs that highlighted action when the user has not
  // already done so, preventing a targetless dialog step.
  if (
    direction === 1 &&
    current?.advanceByClickingTarget &&
    next &&
    !visibleTarget(next.targetId)
  ) {
    guideState.preparing = true;
    visibleTarget(current.targetId)?.click();
    await waitForVisibleTarget(next.targetId, 3_000);
  }

  guideState.setupStepIndex = nextIndex;
  if (next) await prepareSetupStep(next);
}

export function closeSetupGuide(): void {
  preparationId += 1;
  guideState.mode = "paused";
  guideState.preparing = false;
}

function beginProductTour(): void {
  presentationSnapshot ??= capturePresentation();
  guideState.runSteps = guideItemsForRun(
    tourSteps,
    completedProductTourVersion(),
    guideState.manual,
  ).filter(
    (step) => step.id !== "history" || conversationSelectors.activeConversation,
  );
  if (guideState.runSteps.length === 0) guideState.runSteps = [...tourSteps];
  guideState.stepIndex = 0;
  guideState.mode = "tour";
  const step = currentTourStep();
  if (step) void prepareTourStep(step);
}

export function startProductTour(): void {
  if (needsProjectForTour(Boolean(workspaceSelectors.activeProject))) {
    guideState.awaitingProject = true;
    guideState.mode = "paused";
    workspaceState.projectPickerOpen = true;
    return;
  }
  beginProductTour();
}

export function continueDeferredTour(): void {
  if (
    !deferredTourCanContinue({
      awaitingProject: guideState.awaitingProject,
      hasActiveProject: Boolean(workspaceSelectors.activeProject),
      projectPickerOpen: workspaceState.projectPickerOpen,
    })
  )
    return;
  guideState.awaitingProject = false;
  beginProductTour();
}

export function moveTour(direction: -1 | 1): void {
  const next = adjacentStep(
    guideState.stepIndex,
    guideState.runSteps.length,
    direction,
  );
  if (next === guideState.stepIndex) return;
  guideState.stepIndex = next;
  const step = currentTourStep();
  if (step) void prepareTourStep(step);
}

function closeGuide(): void {
  preparationId += 1;
  guideState.mode = "closed";
  guideState.preparing = false;
  guideState.awaitingProject = false;
  restorePresentation();
  requestAnimationFrame(() => {
    document
      .querySelector<HTMLElement>('[data-tour-id="help"]')
      ?.focus({ preventScroll: true });
  });
}

export function notNow(): void {
  closeGuide();
}

export function doNotShowAgain(): void {
  const draft = settingsState.settingsDraft;
  if (draft && draft.ui.onboardingVersion < CURRENT_ONBOARDING_VERSION) {
    draft.ui.onboardingVersion = CURRENT_ONBOARDING_VERSION;
    queueSettingsSave(
      { ui: { onboardingVersion: CURRENT_ONBOARDING_VERSION } },
      { immediate: true },
    );
  }
  closeGuide();
}

export function finishProductTour(): void {
  if (guideState.completedProductTourVersion < CURRENT_PRODUCT_TOUR_VERSION) {
    guideState.completedProductTourVersion = CURRENT_PRODUCT_TOUR_VERSION;
    writeProductTourCompletionVersion(CURRENT_PRODUCT_TOUR_VERSION);
  }
  preparationId += 1;
  guideState.preparing = false;
  restorePresentation();
  guideState.mode = "setup";
}
