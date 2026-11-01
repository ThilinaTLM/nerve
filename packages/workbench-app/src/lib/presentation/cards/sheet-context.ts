import { getContext, setContext } from "svelte";

const KEY = Symbol("card-sheet");

/** `CardSheet` provides this so nested code blocks sit flush, without borders. */
export function provideCardSheet(): void {
  setContext(KEY, true);
}

/**
 * Opts a subtree out of an enclosing `CardSheet`, so an embedded card preview
 * (such as the details dialog's formatted view) renders its own sheet.
 */
export function leaveCardSheet(): void {
  setContext(KEY, false);
}

export function inCardSheet(): boolean {
  return getContext<boolean | undefined>(KEY) === true;
}
