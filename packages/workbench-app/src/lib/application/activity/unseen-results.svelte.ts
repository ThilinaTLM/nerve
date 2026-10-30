import { SvelteSet } from "svelte/reactivity";

/**
 * Root conversations whose finished, failed or interrupted result the user has
 * not seen yet. Session-local and bounded by the number of conversations.
 */
export const unseenResults = new SvelteSet<string>();
