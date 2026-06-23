import { onAnyEvent, type WorkbenchEvent } from "$lib/core/events/event-bus";
import { refreshProviderCatalog } from "./auth.svelte";
import { authState } from "./auth-state.svelte";

export function registerAuthEventHandlers(): () => void {
  return onAnyEvent(handleAuthEvent);
}

function handleAuthEvent(event: WorkbenchEvent): void {
  // Only the provider catalog needs a dedicated refresh; provider/key metadata
  // is refreshed by the settings event handler. Skip when the tab was never
  // opened to avoid needless requests.
  if (!authState.catalogLoaded) return;
  if (event.type.startsWith("providers.")) {
    void refreshProviderCatalog();
  }
}
