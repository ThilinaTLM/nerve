import { getContext, setContext } from "svelte";
import { MediaQuery } from "svelte/reactivity";

/** How a PopoverPanel renders its content: anchored to the trigger, or as a
 * bottom sheet on phone-sized viewports. */
export type PopoverPresentation = "popover" | "sheet";

const KEY = Symbol("popover-presentation");

/** Phone tier, matching the workbench shell's `max-width: 639px`. */
const phoneQuery =
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? new MediaQuery("max-width: 639px")
    : undefined;

export function phoneViewport(): boolean {
  return phoneQuery?.current ?? false;
}

export function setPopoverPresentation(get: () => PopoverPresentation): void {
  setContext(KEY, get);
}

/** Reads the enclosing panel's presentation (`popover` outside a panel).
 * Call during component initialisation; the returned getter stays reactive. */
export function usePopoverPresentation(): () => PopoverPresentation {
  const get = getContext<(() => PopoverPresentation) | undefined>(KEY);
  return () => get?.() ?? "popover";
}
