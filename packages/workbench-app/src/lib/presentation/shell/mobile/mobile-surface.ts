import { getContext, setContext } from "svelte";

const MOBILE_SURFACE = Symbol("mobile-surface");

/**
 * Marks a subtree as rendered by the phone shell. Shared views read it once
 * at mount and swap in their phone-specific layout components, so desktop
 * components never carry phone branches.
 */
export function setMobileSurface(): void {
  setContext(MOBILE_SURFACE, true);
}

export function isMobileSurface(): boolean {
  return getContext<boolean | undefined>(MOBILE_SURFACE) ?? false;
}
