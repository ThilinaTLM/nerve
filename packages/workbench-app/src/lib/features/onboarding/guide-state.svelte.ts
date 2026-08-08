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
  guideItemsForRun,
  tourSteps,
  type TourStep,
} from "./guide-content.js";
import { adjacentStep, shouldAutoOpenGuide } from "./guide-controller.js";
import {
  summarizeAgentDefaults,
  type AgentDefaultsSetupSummary,
} from "./setup-summary.js";
import {
  activeTabIsConversation,
  deferredTourCanContinue,
  needsProjectForTour,
} from "./tour-readiness.js";

type GuideMode = "closed" | "setup" | "paused" | "tour";

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
});

let presentationSnapshot: PresentationSnapshot | undefined;
let preparationId = 0;

export function completedOnboardingVersion(): number {
  return settingsState.settingsDraft?.ui.onboardingVersion ?? 0;
}

export function guideUnseen(): boolean {
  return completedOnboardingVersion() < CURRENT_ONBOARDING_VERSION;
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
  if (!draft) {
    return { configured: false, text: "Agent defaults are loading." };
  }
  return summarizeAgentDefaults(draft, settingsState.models);
}

export function agentDefaultsConfigured(): boolean {
  return agentDefaultsSummary().configured;
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
  ) {
    return;
  }
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

export function pauseForProviders(): void {
  guideState.mode = "paused";
  openAuthPane();
}

export function pauseForScopedModels(): void {
  guideState.mode = "paused";
  void openSettingsPane("models", "models");
}

export function pauseForAgentSettings(): void {
  guideState.mode = "paused";
  void openSettingsPane("agents", "defaults");
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
  const target = document.querySelector<HTMLElement>(
    '[data-tour-id="conversation-history"]',
  );
  target
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

export function currentTourStep(): TourStep | undefined {
  return guideState.runSteps[guideState.stepIndex];
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

async function prepareStep(step: TourStep): Promise<void> {
  const requestId = ++preparationId;
  guideState.preparing = true;
  guideState.targetAvailable = false;

  if (step.id !== "history") closeConversationHistory();

  const panelView = tourPanelViewByStep[step.id];
  if (panelView) {
    revealPanelViewTemporarily(panelView, responsive.isCompact);
  } else if (step.id === "composer") {
    if (!activeTabIsConversation(workspaceSelectors.activeCenterTab?.kind)) {
      newConversation();
      await tick();
    }
  } else if (step.id === "history") {
    if (conversationSelectors.activeConversation) openConversationHistory();
  } else if (step.id === "skills") {
    await openSettingsPane("skills");
  }

  await tick();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  if (requestId !== preparationId || guideState.mode !== "tour") return;
  guideState.targetAvailable = Boolean(
    step.targetId &&
    document.querySelector(`[data-tour-id="${step.targetId}"]`),
  );
  guideState.preparing = false;
}

function beginProductTour(): void {
  presentationSnapshot ??= capturePresentation();
  guideState.runSteps = guideItemsForRun(
    tourSteps,
    completedOnboardingVersion(),
    guideState.manual,
  ).filter(
    (step) => step.id !== "history" || conversationSelectors.activeConversation,
  );
  if (guideState.runSteps.length === 0) guideState.runSteps = [...tourSteps];
  guideState.stepIndex = 0;
  guideState.mode = "tour";
  const step = currentTourStep();
  if (step) void prepareStep(step);
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
  ) {
    return;
  }
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
  if (step) void prepareStep(step);
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

export function completeGuide(): void {
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
