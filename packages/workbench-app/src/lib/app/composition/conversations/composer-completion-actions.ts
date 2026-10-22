import { responsive } from "$lib/app/shell/responsive.svelte";
import {
  activatePanelView,
  revealPanelView,
} from "$lib/app/shell/shell-layout.svelte";
import { openSettingsPane } from "$lib/application/settings/settings-actions.svelte";
import type { ComposerCompletionAction } from "$lib/presentation/composer/composer-editor-completions";

export type CapabilitySettingsPage = "tools" | "skills" | "profiles";

/** Shared by the prompt composer and the ask_user reply input. */
export function handleComposerCompletionAction(
  action: ComposerCompletionAction,
  openCapabilitySettings: (page: CapabilitySettingsPage) => void,
): void {
  if (action.type === "source") {
    if (action.actionId === "open_pull_requests") {
      // The Pull requests panel shows the gh CLI install / sign-in guidance.
      revealPanelView("pull-requests", responsive.isCompact);
      activatePanelView("pull-requests");
    } else {
      void openSettingsPane();
    }
    return;
  }
  switch (action.item.kind) {
    case "skill":
      openCapabilitySettings("skills");
      break;
    case "tool":
      openCapabilitySettings("tools");
      break;
    default:
      openCapabilitySettings("profiles");
  }
}
