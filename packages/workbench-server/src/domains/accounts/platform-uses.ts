import type { PlatformUse } from "@nervekit/extension-api";

/** One extension's use of a platform. */
export type PlatformUseEntry = PlatformUse & { extensionId: string };

/** What the scope union reads: the uses of the extensions enabled where an account lives. */
export interface PlatformUseSource {
  /** Re-reads which extensions are enabled; cheap when called again within `ttlMs`. */
  refresh(): Promise<void>;
  /** The uses of extensions enabled for accounts at `projectId` (null: user level), as of the last refresh. */
  usesFor(projectId: string | null): readonly PlatformUse[];
}

/**
 * The uses that count for an account level: an extension counts for user-level accounts when it
 * is enabled at user scope, and for a project's accounts when it is enabled in that project.
 * Derived on read from the extension settings resolution; nothing is stored.
 */
export function enabledPlatformUses(deps: {
  /** Every extension's uses. */
  uses: () => readonly PlatformUseEntry[];
  /** Which extensions are enabled at user scope (null) or in a project; one not known there is not. */
  enabled: (
    projectId: string | null,
  ) => Promise<(extensionId: string) => boolean>;
  /** Levels to resolve: user (null) and the projects that hold accounts. */
  levels: () => readonly (string | null)[];
  ttlMs?: number;
  now?: () => number;
}): PlatformUseSource {
  const byLevel = new Map<string, readonly PlatformUse[]>();
  const key = (projectId: string | null) => projectId ?? "";
  let at = Number.NEGATIVE_INFINITY;
  let inFlight: Promise<void> | undefined;
  const now = () => deps.now?.() ?? Date.now();
  const load = async () => {
    const entries = deps.uses();
    const next = new Map<string, readonly PlatformUse[]>();
    for (const level of new Set([null, ...deps.levels()])) {
      const isEnabled = await deps.enabled(level);
      next.set(
        key(level),
        entries.flatMap(({ extensionId, ...use }) =>
          isEnabled(extensionId) ? [use] : [],
        ),
      );
    }
    byLevel.clear();
    for (const [level, uses] of next) byLevel.set(level, uses);
    at = now();
  };
  return {
    refresh: async () => {
      if (now() - at < (deps.ttlMs ?? 1000)) return;
      inFlight ??= load().finally(() => (inFlight = undefined));
      await inFlight;
    },
    usesFor: (projectId) => byLevel.get(key(projectId)) ?? [],
  };
}
