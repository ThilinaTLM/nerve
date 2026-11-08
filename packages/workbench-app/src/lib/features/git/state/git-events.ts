import { registerPrStoreEvents } from "./pr-store.svelte";
import { registerGitContextSync } from "./git-context.svelte";
import { registerGitStoreEvents } from "./git-store.svelte";

export function registerGitEventHandlers(): () => void {
  const unregisterPrs = registerPrStoreEvents();
  const unregisterStore = registerGitStoreEvents();
  const unregisterContext = registerGitContextSync();
  return () => {
    unregisterContext();
    unregisterStore();
    unregisterPrs();
  };
}
