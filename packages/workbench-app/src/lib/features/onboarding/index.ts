export { default as OnboardingHost } from "./components/OnboardingHost.svelte";
export {
  CURRENT_ONBOARDING_VERSION,
  CURRENT_PRODUCT_TOUR_VERSION,
} from "./guide-content.js";
export {
  guideState,
  guideUnseen,
  openGuide,
  setupPaused,
  setupProgress,
} from "./guide-state.svelte.js";
