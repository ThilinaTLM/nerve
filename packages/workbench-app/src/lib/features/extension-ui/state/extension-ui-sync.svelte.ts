import { onEvent } from "$lib/application/events/workbench-event-bus";
import { workbenchStartupState } from "$lib/application/startup/workbench-startup-state.svelte";
import { workspaceState } from "$lib/application/workspace/workspace-state.svelte";
import {
  loadExtensionContributions,
  loadExtensionUiThemes,
} from "./extension-ui.svelte";

/**
 * Keeps extension themes and the active project's UI contributions loaded. Call during
 * component initialization. Progressive work: it starts after the composer-critical phase; the
 * chosen extension theme paints from its cached tokens until then.
 */
export function createExtensionUiSync(projectId: () => string | undefined) {
  const ready = $derived(
    workbenchStartupState.progressiveActive &&
      workspaceState.connection === "connected",
  );

  $effect(() => {
    if (ready) void loadExtensionUiThemes();
  });

  $effect(() => {
    const id = projectId();
    if (ready && id) void loadExtensionContributions(id);
  });

  $effect(() => {
    if (!ready) return;
    return onEvent("extensions.changed", () => {
      void loadExtensionUiThemes();
      const id = projectId();
      if (id) void loadExtensionContributions(id);
    });
  });
}
