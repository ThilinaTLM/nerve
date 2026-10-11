<script lang="ts">
import type { Project } from "@nervekit/contracts/core";
import type { LaunchRecord } from "$lib/api";
import type { CancelLaunchRequest } from "@nervekit/contracts/launches";
import { createWorkbenchLaunchPanelAdapter } from "$lib/features/launches/state/workbench-launch-panel-adapter.svelte";
import { LaunchesPanel } from "$lib/features/launches";

type Props = {
  activeProject?: Project;
  launches?: LaunchRecord[];
  selectedLaunch?: LaunchRecord;
  homeDir?: string;
  onOpenLaunchOutput?: (id: string) => void;
  onCancelLaunch?: (id: string, request?: CancelLaunchRequest) => void;
  onRestartLaunch?: (id: string) => void;
  onRemoveLaunch?: (id: string) => void;
  onCleanupRuns?: (ids: readonly string[]) => void;
  onPruneLaunches?: () => void;
  onRunCommand?: (input: {
    projectId: string;
    cwd: string;
    command: string;
    name?: string;
  }) => void;
};

let {
  activeProject,
  launches = [],
  selectedLaunch,
  onOpenLaunchOutput,
  onCancelLaunch,
  onRestartLaunch,
  onRemoveLaunch,
  onCleanupRuns,
  onPruneLaunches,
  onRunCommand,
}: Props = $props();

const adapter = createWorkbenchLaunchPanelAdapter(
  () => activeProject,
  () => launches,
  () => selectedLaunch,
  {
    openLaunchOutput: (id) => onOpenLaunchOutput?.(id),
    cancelLaunch: (id, request) => onCancelLaunch?.(id, request),
    restartLaunch: (id) => onRestartLaunch?.(id),
    removeLaunch: (id) => onRemoveLaunch?.(id),
    cleanupRuns: (ids) => onCleanupRuns?.(ids),
    pruneLaunches: () => onPruneLaunches?.(),
    runCommand: (input) => onRunCommand?.(input),
  },
);
</script>

<LaunchesPanel model={adapter.model} actions={adapter.actions} />
