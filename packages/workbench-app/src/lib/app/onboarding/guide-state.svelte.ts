import { tick } from "svelte";
import { responsive } from "$lib/app/shell/responsive.svelte";
import {
  captureShellPresentation,
  restoreShellPresentation,
  revealPanelViewTemporarily,
  type ShellPresentationSnapshot,
} from "$lib/app/shell/shell-layout.svelte";
import { workbenchStartupState } from "$lib/application/startup/workbench-startup-state.svelte";
import { hasChatGptAudioAuth } from "$lib/features/audio";
import { conversationSelectors } from "$lib/features/conversations";
import { openConversationHistory } from "$lib/features/conversations/state/composer-signals.svelte";
import { settingsState } from "$lib/features/settings/state/settings-state.svelte";
import { openSettingsPane } from "$lib/features/settings/state/settings-actions.svelte";
import {
  captureCenterTabsPresentation,
  restoreCenterTabsPresentation,
  type CenterTabsPresentationSnapshot,
} from "$lib/application/workspace/center-tabs.svelte";
import { workspaceSelectors } from "$lib/application/workspace";
import { newConversation } from "$lib/application/workspace/workspace-actions.svelte";
import { workspaceState } from "$lib/application/workspace/workspace-state.svelte";
import { guideCatalog, type GuideId } from "./guide-catalog.js";
import {
  autoCompletedGuideIds,
  incompleteGuideCount as countIncompleteGuides,
  resolveGuides,
  shouldAutoOpenCatalog,
  type GuideSignals,
  type ResolvedGuide,
} from "./guide-catalog-policy.js";
import {
  completeGuideVersion,
  readGuideCompletionVersions,
  writeGuideCompletionVersions,
  type GuideCompletionVersions,
} from "./guide-completion.js";
import { guideItemsForRun, tourSteps, type TourStep } from "./guide-content.js";
import { adjacentStep } from "./guide-controller.js";
import { setupStepsForArea, adjacentSetupStep } from "./setup-guide-policy.js";
import type { SetupGuideArea, SetupGuideStep } from "./setup-guide-content.js";
import { activeTabIsConversation } from "./tour-readiness.js";

type GuideMode = "closed" | "catalog" | "tour" | "preparing-coach" | "coach";

type PresentationSnapshot = {
  shell: ShellPresentationSnapshot;
  tabs: CenterTabsPresentationSnapshot;
  settingsPageId: string;
  settingsSectionId: string;
  historyOpen: boolean;
};

export const guideState = $state({
  mode: "closed" as GuideMode,
  consideredGeneration: undefined as number | undefined,
  preparing: false,
  targetAvailable: false,
  runSteps: [] as TourStep[],
  stepIndex: 0,
  activeGuideId: undefined as GuideId | undefined,
  setupArea: undefined as SetupGuideArea | undefined,
  setupSteps: [] as SetupGuideStep[],
  setupStepIndex: 0,
  completionVersions: readGuideCompletionVersions() as GuideCompletionVersions,
});

let presentationSnapshot: PresentationSnapshot | undefined;
let preparationId = 0;

export function providerConfigured(): boolean {
  return settingsState.authProviders.some((provider) => provider.configured);
}

export function voiceConfigured(): boolean {
  return hasChatGptAudioAuth(settingsState.authProviders);
}

export function webSearchConfigured(): boolean {
  const profileId = settingsState.settingsDraft?.tools.web.tavilyProfileId;
  return Boolean(
    profileId &&
    settingsState.authProviders.some(
      (provider) =>
        provider.provider === `tavily:${profileId}` &&
        provider.configured &&
        provider.credentialType === "api_key",
    ),
  );
}

function guideSignals(): GuideSignals {
  return {
    "project-open": Boolean(workspaceSelectors.activeProject),
    "provider-ready": providerConfigured(),
    "voice-ready": voiceConfigured(),
    "web-search-ready": webSearchConfigured(),
  };
}

export function catalogGuides(): ResolvedGuide[] {
  return resolveGuides(
    guideCatalog,
    guideState.completionVersions,
    guideSignals(),
  );
}

export function incompleteGuideCount(): number {
  return countIncompleteGuides(catalogGuides());
}

function persistCompletionVersions(versions: GuideCompletionVersions): void {
  guideState.completionVersions = versions;
  writeGuideCompletionVersions(versions);
}

export function markGuideCompleted(id: GuideId): void {
  const guide = guideCatalog.find((candidate) => candidate.id === id);
  if (!guide || guide.lifecycle === "upcoming") return;
  const versions = completeGuideVersion(
    guideState.completionVersions,
    id,
    guide.version,
  );
  if (versions !== guideState.completionVersions)
    persistCompletionVersions(versions);
}

function reconcileComputedCompletion(): void {
  const resolved = catalogGuides();
  let versions = guideState.completionVersions;
  for (const id of autoCompletedGuideIds(resolved, versions)) {
    const guide = guideCatalog.find((candidate) => candidate.id === id);
    if (guide) versions = completeGuideVersion(versions, id, guide.version);
  }
  if (versions !== guideState.completionVersions)
    persistCompletionVersions(versions);
}

export function considerAutomaticGuide(): void {
  if (!workbenchStartupState.progressiveActive || !settingsState.settingsDraft)
    return;
  reconcileComputedCompletion();
  const generation = workbenchStartupState.generation;
  if (
    !shouldAutoOpenCatalog({
      progressiveActive: workbenchStartupState.progressiveActive,
      settingsLoaded: Boolean(settingsState.settingsDraft),
      incompleteCount: incompleteGuideCount(),
      generation,
      consideredGeneration: guideState.consideredGeneration,
    })
  )
    return;
  guideState.consideredGeneration = generation;
  guideState.mode = "catalog";
}

export function openGuide(): void {
  guideState.mode = "catalog";
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

async function settleTargetAnimations(
  target: HTMLElement | undefined,
): Promise<void> {
  if (!target) return;
  const animations: Animation[] = [];
  for (
    let element: HTMLElement | null = target;
    element;
    element = element.parentElement
  ) {
    for (const animation of element.getAnimations()) {
      if (["pending", "running"].includes(animation.playState))
        animations.push(animation);
    }
  }
  if (animations.length === 0) return;
  await Promise.allSettled(animations.map((animation) => animation.finished));
  await settlePreparation();
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
  await settleTargetAnimations(visibleTarget(step.targetId));
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
  if (enterCoach && !target && preparation?.kind === "settings") {
    await openSettingsPane(preparation.pageId, preparation.sectionId);
  }

  await settlePreparation();
  target = await waitForVisibleTarget(step.targetId, enterCoach ? 3_000 : 150);
  if (
    requestId !== preparationId ||
    !["preparing-coach", "coach"].includes(guideState.mode)
  )
    return;
  target?.scrollIntoView({
    behavior: "instant",
    block: "nearest",
    inline: "nearest",
  });
  await settlePreparation();
  await settleTargetAnimations(target);
  if (
    requestId !== preparationId ||
    !["preparing-coach", "coach"].includes(guideState.mode)
  )
    return;
  guideState.mode = "coach";
  guideState.targetAvailable = Boolean(visibleTarget(step.targetId));
  guideState.preparing = false;
}

function startSetupGuide(id: GuideId, area: SetupGuideArea): void {
  guideState.activeGuideId = id;
  guideState.setupArea = area;
  guideState.setupSteps = setupStepsForArea(area, {
    codexConnected: voiceConfigured(),
  });
  guideState.setupStepIndex = 0;
  guideState.mode = "preparing-coach";
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

function returnFromActiveRun(): void {
  if (
    guideState.activeGuideId === "open-project" &&
    workspaceState.projectPickerOpen
  ) {
    guideState.mode = "closed";
    return;
  }
  guideState.mode = "catalog";
}

export function closeActiveRun(): void {
  preparationId += 1;
  guideState.preparing = false;
  if (guideState.mode === "tour") restorePresentation();
  returnFromActiveRun();
}

export function finishActiveRun(): void {
  const id = guideState.activeGuideId;
  if (id) markGuideCompleted(id);
  preparationId += 1;
  guideState.preparing = false;
  if (guideState.mode === "tour") restorePresentation();
  returnFromActiveRun();
}

function beginWorkbenchTour(): void {
  const definition = guideCatalog.find((guide) => guide.id === "workbench");
  if (!definition) return;
  presentationSnapshot ??= capturePresentation();
  const completedVersion = guideState.completionVersions.workbench ?? 0;
  guideState.runSteps = guideItemsForRun(
    tourSteps,
    completedVersion,
    completedVersion >= definition.version,
  ).filter(
    (step) => step.id !== "history" || conversationSelectors.activeConversation,
  );
  if (guideState.runSteps.length === 0) guideState.runSteps = [...tourSteps];
  guideState.activeGuideId = "workbench";
  guideState.stepIndex = 0;
  guideState.mode = "tour";
  const step = currentTourStep();
  if (step) void prepareTourStep(step);
}

export function startGuide(id: GuideId): void {
  const guide = catalogGuides().find((candidate) => candidate.id === id);
  if (!guide || !guide.available) return;
  if (!guide.run) {
    markGuideCompleted(guide.id);
    return;
  }
  if (guide.run.kind === "setup-coach") {
    startSetupGuide(guide.id, guide.run.area);
    return;
  }
  if (!workspaceSelectors.activeProject) {
    startGuide("open-project");
    return;
  }
  beginWorkbenchTour();
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
  restorePresentation();
  requestAnimationFrame(() => {
    document
      .querySelector<HTMLElement>('[data-tour-id="help"]')
      ?.focus({ preventScroll: true });
  });
}

export function later(): void {
  closeGuide();
}
