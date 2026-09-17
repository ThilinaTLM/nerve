import type { CapabilitySelection } from "@nervekit/contracts/capabilities";

const sameNames = (
  left: readonly string[],
  right: readonly string[],
): boolean => {
  if (left.length !== right.length) return false;
  const remaining = new Set(left);
  return right.every((name) => remaining.delete(name));
};

export function sameCapabilitySelection(
  left: CapabilitySelection,
  right: CapabilitySelection,
): boolean {
  return (
    sameNames(left.disabledTools, right.disabledTools) &&
    sameNames(left.disabledFileSkills, right.disabledFileSkills) &&
    sameNames(left.enabledAgentBrowserSkills, right.enabledAgentBrowserSkills)
  );
}

export interface CapabilityRefresher {
  /** Re-resolves capabilities and republishes resources when they changed. */
  refresh(): Promise<void>;
}

/**
 * Keeps a live run's skills and active tools in step with user, project, and
 * conversation capability changes. Resources are only reloaded when the
 * resolved selection actually differs, so per-turn refreshes stay cheap.
 */
export function createCapabilityRefresher<TResources>(deps: {
  initialSelection: CapabilitySelection;
  resolve: () => Promise<CapabilitySelection>;
  loadResources: (selection: CapabilitySelection) => Promise<TResources>;
  applyResources: (resources: TResources) => Promise<void>;
  applyToolNames: (selection: CapabilitySelection) => Promise<void>;
  onError?: (error: unknown) => void;
}): CapabilityRefresher {
  let selection = deps.initialSelection;
  let inFlight: Promise<void> | undefined;

  const run = async (): Promise<void> => {
    const next = await deps.resolve();
    if (sameCapabilitySelection(selection, next)) return;
    const previous = selection;
    selection = next;
    if (!sameNames(previous.disabledTools, next.disabledTools))
      await deps.applyToolNames(next);
    if (
      sameNames(previous.disabledFileSkills, next.disabledFileSkills) &&
      sameNames(
        previous.enabledAgentBrowserSkills,
        next.enabledAgentBrowserSkills,
      )
    )
      return;
    await deps.applyResources(await deps.loadResources(next));
  };

  return {
    refresh(): Promise<void> {
      inFlight ??= run()
        .catch((error) => deps.onError?.(error))
        .finally(() => {
          inFlight = undefined;
        });
      return inFlight;
    },
  };
}
