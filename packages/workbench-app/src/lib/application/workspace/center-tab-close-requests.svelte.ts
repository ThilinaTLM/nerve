import { fileViewKey } from "$lib/domain/navigation/view-keys";
import { workspaceFeaturePorts } from "./workspace-feature-ports.svelte";
import type { CenterTabIdentity } from "./workspace-state.svelte";
import { closeCenterTab } from "./center-tabs.svelte";
import { closeCenterTabs } from "./center-tab-actions.svelte";
import {
  canCloseDirtyFiles,
  type DirtyFileCloseTarget,
  type UnsavedFileChoice,
} from "./dirty-file-close-policy";

export type { UnsavedFileChoice } from "./dirty-file-close-policy";

export const unsavedFileClosePrompt = $state<{
  open: boolean;
  files: DirtyFileCloseTarget[];
}>({ open: false, files: [] });

let resolvePrompt: ((choice: UnsavedFileChoice) => void) | undefined;
let promptQueue = Promise.resolve();

function promptForUnsavedFiles(
  files: DirtyFileCloseTarget[],
): Promise<UnsavedFileChoice> {
  const pending = promptQueue.then(
    () =>
      new Promise<UnsavedFileChoice>((resolve) => {
        resolvePrompt = resolve;
        unsavedFileClosePrompt.files = files;
        unsavedFileClosePrompt.open = true;
      }),
  );
  promptQueue = pending.then(
    () => undefined,
    () => undefined,
  );
  return pending;
}

export function resolveUnsavedFileClosePrompt(choice: UnsavedFileChoice): void {
  const resolve = resolvePrompt;
  if (!resolve) return;
  resolvePrompt = undefined;
  unsavedFileClosePrompt.open = false;
  unsavedFileClosePrompt.files = [];
  resolve(choice);
}

export function hasDirtyFileViews(): boolean {
  return Object.values(workspaceFeaturePorts().filesystem.read.fileViews).some(
    (view) => view.dirty,
  );
}

async function canCloseFileTabs(tabs: CenterTabIdentity[]): Promise<boolean> {
  const filesystem = workspaceFeaturePorts().filesystem;
  const dirtyFiles = tabs.flatMap((tab): DirtyFileCloseTarget[] => {
    if (tab.kind !== "file") return [];
    const view = filesystem.read.fileViews[fileViewKey(tab.id)];
    if (!view?.dirty) return [];
    return [{ id: tab.id, name: view.content?.relativePath ?? view.path }];
  });
  return canCloseDirtyFiles(dirtyFiles, promptForUnsavedFiles, (id) =>
    filesystem.commands.saveFileView(id),
  );
}

export async function confirmFileTabsAtPath(input: {
  projectId: string;
  path: string;
  descendants?: boolean;
}): Promise<boolean> {
  const tabs = Object.values(workspaceFeaturePorts().filesystem.read.fileViews)
    .filter((view) => {
      const path = view.content?.relativePath ?? view.path;
      return (
        view.projectId === input.projectId &&
        (path === input.path ||
          Boolean(input.descendants && path.startsWith(`${input.path}/`)))
      );
    })
    .map((view) => ({ kind: "file" as const, id: view.id }));
  return canCloseFileTabs(tabs);
}

export async function requestCloseCenterTab(
  tab: CenterTabIdentity,
): Promise<void> {
  if (!(await canCloseFileTabs([tab]))) return;
  await closeCenterTab(tab);
}

export async function requestCloseCenterTabs(
  tabs: CenterTabIdentity[],
  fallbackPreferred?: CenterTabIdentity,
): Promise<void> {
  if (!(await canCloseFileTabs(tabs))) return;
  await closeCenterTabs(tabs, fallbackPreferred);
}
