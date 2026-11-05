import { getContext, setContext } from "svelte";

const KEY = Symbol("card-sheet");

/** `CardSheet` provides this so nested code blocks sit flush, without borders. */
export function provideCardSheet(): void {
  setContext(KEY, true);
}

export function inCardSheet(): boolean {
  return getContext<boolean | undefined>(KEY) === true;
}
