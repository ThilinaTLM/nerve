export interface StartupSequenceTimings {
  loadingWindowMs: number;
  daemonReadyMs: number;
  prerequisitesReadyMs: number;
  navigationMs: number;
  totalMs: number;
}

export interface StartupSequenceResult<T> {
  daemon: T;
  navigated: boolean;
  timings: StartupSequenceTimings;
}

export type StartupProgressPhase = "daemon-ready" | "prerequisites-ready";

export interface StartupSequenceDependencies<T> {
  showLoadingWindow: () => Promise<void>;
  connectDaemon: () => Promise<T>;
  networkReady: Promise<void>;
  prepareDaemonConnection: (daemon: T) => Promise<void>;
  reportProgress: (phase: StartupProgressPhase) => Promise<void>;
  canNavigate: () => boolean;
  navigate: (daemon: T) => Promise<void>;
  now?: () => number;
}

/**
 * Orders the visible desktop cold-start path while allowing Electron network
 * setup to overlap daemon launch. The final navigation remains gated on every
 * authentication/cache/settings prerequisite.
 */
export async function runStartupSequence<T>(
  dependencies: StartupSequenceDependencies<T>,
): Promise<StartupSequenceResult<T>> {
  const now = dependencies.now ?? performance.now.bind(performance);
  const startedAt = now();
  await dependencies.showLoadingWindow();
  const loadingWindowMs = Math.round(now() - startedAt);

  const daemon = await dependencies.connectDaemon();
  const daemonReadyMs = Math.round(now() - startedAt);
  await Promise.all([
    dependencies.reportProgress("daemon-ready"),
    dependencies.networkReady,
    dependencies.prepareDaemonConnection(daemon),
  ]);
  const prerequisitesReadyMs = Math.round(now() - startedAt);
  await dependencies.reportProgress("prerequisites-ready");

  if (!dependencies.canNavigate()) {
    return {
      daemon,
      navigated: false,
      timings: {
        loadingWindowMs,
        daemonReadyMs,
        prerequisitesReadyMs,
        navigationMs: 0,
        totalMs: Math.round(now() - startedAt),
      },
    };
  }

  const navigationStartedAt = now();
  await dependencies.navigate(daemon);
  const navigationMs = Math.round(now() - navigationStartedAt);
  return {
    daemon,
    navigated: true,
    timings: {
      loadingWindowMs,
      daemonReadyMs,
      prerequisitesReadyMs,
      navigationMs,
      totalMs: Math.round(now() - startedAt),
    },
  };
}
