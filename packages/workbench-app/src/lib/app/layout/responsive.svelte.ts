import { MediaQuery } from "svelte/reactivity";

// Viewport tiers (Tailwind default scale):
//  - desktop: >= 1024px  -> current resizable 3-pane layout, untouched
//  - compact: <  1024px  -> single-column center + slide-over drawers
//  - phone:   <   640px  -> compact + density/touch tweaks
//
// `MediaQuery` from svelte/reactivity auto-wraps the feature in parentheses and
// exposes a reactive `.current`. Instantiated lazily so this module is safe to
// import outside the browser; the queries default to the desktop tier.
const COMPACT_QUERY = "max-width: 1023px";
const PHONE_QUERY = "max-width: 639px";

let compactQuery: MediaQuery | undefined;
let phoneQuery: MediaQuery | undefined;

if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
  compactQuery = new MediaQuery(COMPACT_QUERY);
  phoneQuery = new MediaQuery(PHONE_QUERY);
}

export const responsive = {
  /** True below 1024px: navigator + utility collapse into overlay drawers. */
  get isCompact(): boolean {
    return compactQuery?.current ?? false;
  },
  /** True below 640px: phone density/touch tweaks on top of compact mode. */
  get isPhone(): boolean {
    return phoneQuery?.current ?? false;
  },
};
