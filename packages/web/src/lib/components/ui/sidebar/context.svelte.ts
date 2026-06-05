import { getContext, setContext } from "svelte";

/**
 * Minimal, provider-light sidebar context.
 *
 * The navigator panel only uses the sidebar list/group primitives, not the full
 * sidebar layout chrome. The only primitive that depends on this context is
 * `SidebarMenuButton` (purely to decide whether to show a collapsed-rail tooltip).
 * We never pass `tooltipContent`, so this context only needs to report a static
 * expanded, non-mobile state — no keyboard shortcut, cookie persistence, or mobile
 * sheet behavior.
 */
export type SidebarContext = {
  readonly state: "expanded" | "collapsed";
  readonly open: boolean;
  readonly openMobile: boolean;
  readonly isMobile: boolean;
  setOpen: (value: boolean) => void;
  setOpenMobile: (value: boolean) => void;
  toggle: () => void;
};

const SYMBOL_KEY = "scn-sidebar";

export function setSidebar(ctx: SidebarContext): SidebarContext {
  return setContext(Symbol.for(SYMBOL_KEY), ctx);
}

export function useSidebar(): SidebarContext {
  const ctx = getContext<SidebarContext | undefined>(Symbol.for(SYMBOL_KEY));
  if (!ctx) {
    throw new Error("useSidebar must be used within a Sidebar.Provider");
  }
  return ctx;
}
