export { default as DiscoverStartupHost } from "./DiscoverStartupHost.svelte";
export { default as DiscoverView } from "./components/DiscoverView.svelte";
export type { DiscoverAction } from "./content/entries.js";
export type { DiscoverBadge } from "./policy.js";
export {
  discoverPageModel,
  discoverTitlebarBadge,
  markDiscoverSeen,
  setDiscoverAutoOpen,
  type DiscoverPageModel,
} from "./state.svelte.js";
export { openDiscoverPane } from "./tabs.svelte.js";
