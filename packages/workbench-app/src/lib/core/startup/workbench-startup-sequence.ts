export type WorkbenchStartupPhase =
  | "idle"
  | "critical"
  | "core-ready"
  | "progressive"
  | "failed"
  | "stopped";

export type StartupMilestone = {
  name: string;
  at: number;
};

export type StartupPhaseDuration = {
  phase: "config" | "critical";
  durationMs: number;
};

export type WorkbenchStartupResult = {
  milestones: StartupMilestone[];
  phaseDurations: StartupPhaseDuration[];
  criticalBeforeProgressive: true;
};

export type WorkbenchStartupSequenceDependencies<TConfig, TRestoredTab> = {
  loadClientConfig: () => Promise<TConfig>;
  applyClientConfig: (config: TConfig) => void;
  loadCoreSettings: () => Promise<void>;
  recoverWorkspace: () => Promise<TRestoredTab | undefined>;
  restoreCriticalConversation: (
    desiredTab: TRestoredTab | undefined,
  ) => Promise<boolean>;
  reconcileComposerSelection: () => void | Promise<void>;
  activateDeferredTab: (
    desiredTab: TRestoredTab | undefined,
    conversationRestored: boolean,
  ) => void | Promise<void>;
  startProgressiveWork: () => void;
  transition: (phase: WorkbenchStartupPhase) => boolean;
  isCurrent: () => boolean;
  now?: () => number;
  observeMilestone?: (milestone: StartupMilestone) => void;
};

export async function runWorkbenchStartupSequence<TConfig, TRestoredTab>(
  deps: WorkbenchStartupSequenceDependencies<TConfig, TRestoredTab>,
): Promise<WorkbenchStartupResult> {
  const now = deps.now ?? (() => performance.now());
  const milestones: StartupMilestone[] = [];
  const mark = (name: string) => {
    const milestone = { name, at: now() };
    milestones.push(milestone);
    deps.observeMilestone?.(milestone);
  };
  const startedAt = now();
  let criticalAt: number;

  try {
    mark("config:start");
    const config = await deps.loadClientConfig();
    if (!deps.isCurrent()) return stoppedResult(milestones, startedAt, now());
    deps.applyClientConfig(config);
    mark("config:ready");

    if (!deps.transition("critical"))
      return stoppedResult(milestones, startedAt, now());
    criticalAt = now();
    mark("critical:start");

    const coreSettings = deps
      .loadCoreSettings()
      .then(() => mark("core-settings:ready"));
    // Workspace recovery determines whether conversation restoration is needed;
    // attach a handler now so an early settings failure is never unobserved.
    void coreSettings.catch(() => undefined);
    const workspace = deps.recoverWorkspace().then((desiredTab) => {
      mark("workspace:ready");
      return desiredTab;
    });
    mark("critical:started-concurrently");

    const desiredTab = await workspace;
    if (!deps.isCurrent()) return stoppedResult(milestones, startedAt, now());
    const conversationRestoration = deps
      .restoreCriticalConversation(desiredTab)
      .then((restored) => {
        mark("conversation-restoration:ready");
        return restored;
      });

    const [, conversationRestored] = await Promise.all([
      coreSettings,
      conversationRestoration,
    ]);
    if (!deps.isCurrent()) return stoppedResult(milestones, startedAt, now());
    await deps.reconcileComposerSelection();
    mark("composer-selection:reconciled");

    if (!deps.transition("core-ready"))
      return stoppedResult(milestones, startedAt, now());
    mark("core-ready");
    if (!deps.transition("progressive"))
      return stoppedResult(milestones, startedAt, now());
    mark("progressive");
    try {
      void Promise.resolve(
        deps.activateDeferredTab(desiredTab, conversationRestored),
      ).catch(() => undefined);
    } catch {
      // Progressive feature errors cannot regress composer readiness.
    }
    try {
      deps.startProgressiveWork();
    } catch {
      // Progressive feature errors remain feature-local.
    }
    mark("progressive-work:started");

    return {
      milestones,
      phaseDurations: [
        { phase: "config", durationMs: criticalAt - startedAt },
        { phase: "critical", durationMs: now() - criticalAt },
      ],
      criticalBeforeProgressive: true,
    };
  } catch (error) {
    if (deps.isCurrent()) deps.transition("failed");
    mark("failed");
    throw error;
  }
}

function stoppedResult(
  milestones: StartupMilestone[],
  startedAt: number,
  stoppedAt: number,
): WorkbenchStartupResult {
  return {
    milestones,
    phaseDurations: [
      { phase: "config", durationMs: stoppedAt - startedAt },
      { phase: "critical", durationMs: 0 },
    ],
    criticalBeforeProgressive: true,
  };
}
