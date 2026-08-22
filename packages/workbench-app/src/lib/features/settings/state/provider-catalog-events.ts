import { onAnyEvent, type WorkbenchEvent } from "$lib/kernel/events/event-bus";
import { refreshProviderCatalog } from "./provider-catalog-actions.svelte";
import { providerCatalogState } from "./provider-catalog-state.svelte";

export function registerProviderCatalogEventHandlers(): () => void {
  return onAnyEvent(handleAuthEvent);
}

function handleAuthEvent(event: WorkbenchEvent): void {
  // Only the provider catalog needs a dedicated refresh; provider/key metadata
  // is refreshed by the settings event handler. Skip when the tab was never
  // opened to avoid needless requests.
  if (!providerCatalogState.catalogLoaded) return;
  if (event.type.startsWith("providers.")) {
    void refreshProviderCatalog();
  }
}
